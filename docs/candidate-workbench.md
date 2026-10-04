# 候选商品与 MX/BR 翻译工作台（v0.9.0）

## 操作流程

1. 在 `/console` 的“候选商品”导入 JSON 数据包或编辑已有候选。`GET /api/candidates/template` 提供空白示例；导入前可预览，同 ID 不覆盖人工修改。每批最多 50 款，每款最多 100 个真实 SKU、50 张图片。
2. 记录美客多、Amazon、Temu、Shopee 的商品链接及摘录，保存后逐条点击采集。结果含实际获取的字段或拦截原因；Amazon 页面可提取标题、元信息与卖点；美客多页面被拦时可尝试授权账号的官方商品、描述和类目接口。动态页面没有商品字段就标成不可用。英文草稿的标题（最多 60 字符）、描述和卖点由人工核对；已配置文本 AI 时可根据录入的摘录、采集内容与事实生成待审建议。
3. 按美客多同类商品记录 MX/BR 的实际末级类目 ID 和竞品证据；连接授权账号后读取官方类目树、必填属性与规格轴。类目校验只证实给定 ID 的官方结构和规格能力，不能代替竞品归类判断或 CBT/Child PK 映射。
4. 找到真实货源后，分别填写并确认材质、采购价、包装重量、产品与包装尺寸，编辑真实 SKU、库存、净收益 USD 和可用图片。参考值不自动变成实际值；修改实际值会撤销确认。规格组合必须真实存在，多 SKU 必须有类目允许的变化轴。
5. 在独立的“翻译与输出”页面审阅巴西葡语和墨西哥西语标题、描述、卖点；可按需生成待审翻译建议。英文稿变动会令旧译文失效。导出 Excel，或选定站点转正式草稿。
6. 正式草稿继续完成属性、定价、图片审核与上传、CBT/Child PK 检查、远程预检。明确选择站点且服务器开启发布开关后，原有确认步骤才允许向美客多发出刊登请求。

控制台只单独展示 MLM/MLB；历史 MCO/MLC 数据及原 API 仍保留。候选 Excel 是天船 ERP 的六个工作表，供下载、存档和手工处理；不承诺妙手模板兼容或 Excel 回导。采集只请求预先允许的 HTTPS 商品详情页，限制跳转、时长与响应体大小，不绕过登录、验证码或平台风控。Global UP Family 请求提交英文 Family 名称和英文描述，站点译文保留在天船 ERP 及 Excel 供核对，并不声称平台接口会按此译文刊登。

## 数据包

使用 `schemaVersion: 1`，候选对象包括：

- `id / name / batchId / sourceUrl / notes`：稳定 ID、名称、批次及货源。
- `targetSites`：新流程选 `MLM`、`MLB`；历史数据可仍包含 `MCO`、`MLC`。
- `english`：`title`、`description`、`sellingPoints`。旧数据中的 `familyName / descriptionEnglish` 只用作缺失字段的兼容默认值。
- `researchSources`：最多 40 个 `{platform,url,notes}`，平台是 `MLM`、`MLB`、`Amazon`、`Temu`、`Shopee`，URL 必须是 HTTPS。
- `sites[site]`：当地语言 `title / description / sellingPoints`、本地末级 `categoryId`、`cbtCategoryId`、`attributes`、`evidence`。翻译页确认时记录 `localizedFrom`。
- `facts[key]`：`reference` 与 `actual` 分别含 `value / unit / source / url`；`actual.confirmed` 表示人工确认。常用 key 为 material、purchasePriceCny、packedWeightG、productDimensions、packageDimensions。尺寸形式为 `{ "length": 25, "width": 13, "height": 13, "unit": "cm" }`。
- `skus[]`：`id / sellerSku / color / size / pattern / stock / netProceedsUsd / keep / existsConfirmed / imageId / facts`，不自动生成组合。
- `images[]`：`id`、HTTPS `url`、`status`（reference/pending/usable）、`role`、`prompt`。竞品图不能作为正式刊登图。

## API

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/candidates/template` | 空白示例 |
| POST | `/api/candidates/import/preview`、`/api/candidates/import` | 批量预览、事务导入 |
| GET、PUT | `/api/candidates/:id` | 读取、版本锁保存 |
| POST | `/api/candidates/:id/categories/:site/check` | 官方本地类目与规格检查 |
| POST | `/api/candidates/:id/research/extract` | `{revision,url,accountId?}` 只读采集预览，不自动保存；美客多可用授权账号回退 |
| POST | `/api/candidates/:id/english/suggest` | 根据已录入来源生成英文建议，不保存 |
| POST | `/api/candidates/:id/localize/:site/suggest` | MX/BR 译文建议，不保存 |
| GET | `/api/candidates/export`、`/api/candidates/:id/export` | 六 Sheet Excel；单款可设 `?format=json` |
| POST | `/api/candidates/:id/promote` | `{revision,sites}` 创建正式草稿，重复请求返回原 ID |

接口沿用服务端鉴权与 Origin 检查。2026-10-04 受控样本测试：Amazon.com 的一个商品页实得标题、元描述和卖点；Shopee.com.br 的一个商品页返回只有 JavaScript 的页面壳；Temu.com 的一个商品 URL 未给出可验证标题；MercadoLivre.com.br 的一个商品页及匿名 API 返回 403。以上只代表样本与当前请求环境，美客多授权接口回退已作模拟测试，仍需在真实连接账号上实测。类目核验有效 24 小时；转入正式稿会保存已核验的本地类目评估，发布前仍需实时远程预检。数据库迁移运行 `npm run db:migrate`，包括 `010_candidates.sql` 和 `011_mlb_site.sql`。
