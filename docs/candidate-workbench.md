# 候选商品工作台（v0.8.0）

在现有 `/console` 新增“候选商品”入口。候选数据独立于正式商品，不能直接发布。

## 使用流程

1. 打开候选入口，下载示例JSON结构。把市场研究结果整理为 `schemaVersion: 1` 数据包；每批最多50个候选，每款最多100个真实SKU、50张图片。
2. 选择JSON文件，预览新增项和同ID的已有/传入数据，再导入。已有ID保持原数据，避免覆盖人工修改；要增加新的款式应使用新ID。
3. 编辑MX西语和BR葡语标题、卖点、描述、竞品证据和本地/CBT类目ID。候选还支持MCO、MLC。
4. 保留竞品参考值，补实际材质、采购价、包装重量、产品和包装尺寸以及来源，再逐项确认。尺寸对象使用 `{ "length": 25, "width": 13, "height": 13, "unit": "cm" }`。
5. 修改真实SKU、库存、净收益USD和图片关联。SKU可使用独立参数；存在独立记录时，未确认记录不会回退到共用值。
6. 保存后读取官方末级类目与属性。查询沿用已有授权账号；失败、父类目、过期（24小时）及不支持的规格轴会阻止转入。
7. 导出六Sheet候选工作表，或选择已支持的站点转为正式草稿。转入后继续使用已有审核、类目评估、属性映射、图片审核、定价和远程预检。

修改实际值或来源会撤销该项确认；导出的是服务器已保存内容。页面报版本冲突时，刷新并重新检查改动，不能强行覆盖。

## 数据包

`GET /api/candidates/template` 提供完整可导入示例（无市场结论、无真实商品数据）。字段含义：

- `id`：稳定候选ID，1–100位字母、数字、短横线或下划线。
- `batchId / name / sourceUrl / notes`：批次、名称、货源与说明。
- `targetSites`：MLM、MLB、MCO、MLC中的非空站点列表。
- `familyName / descriptionEnglish`：正式草稿的英文Family名称和共用英文描述。
- `sites[site]`：当地语言`title / description / sellingPoints`、`categoryId`本地末级ID、`cbtCategoryId`、`attributes`和`evidence`竞品证据。研究时间和其他资料也可保留在此对象。
- `facts[key]`：`reference`与`actual`分别保存`value / unit / source / url`，实际记录用`confirmed`表明人工确认。常用key为material、purchasePriceCny、packedWeightG、productDimensions、packageDimensions。
- `skus[]`：id、sellerSku、color、size、pattern、stock、netProceedsUsd、keep、existsConfirmed、imageId、facts。不会自动生成全排列。
- `images[]`：id、HTTPS url、status（reference/pending/usable）、role（primary/shared）、prompt。竞品参考图不能进入正式草稿。

相同ID导入策略是“保留”，不是自动合并；预览展示差异供人工比对。JSON为无损交换格式，Excel为可阅读工作表，当前未提供Excel回导。

## API

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | /api/candidates | 最近100个候选；limit最多200，支持batchId过滤 |
| GET | /api/candidates/template | JSON结构示例 |
| POST | /api/candidates/import/preview | 校验并预览已有/传入数据 |
| POST | /api/candidates/import | 事务批量导入，重复ID不覆盖 |
| GET | /api/candidates/:id | 数据、版本、官方检查、缺失项 |
| PUT | /api/candidates/:id | `{revision,data}`乐观锁保存 |
| POST | /api/candidates/:id/categories/:site/check | `{revision,accountId}`读取官方类目及属性 |
| GET | /api/candidates/export | 最多200个候选的六Sheet Excel |
| GET | /api/candidates/:id/export | 单个候选Excel；format=json导出JSON |
| POST | /api/candidates/:id/promote | `{revision,sites}`事务创建正式草稿，重复请求返回同一个ID |

所有接口沿用已有服务端API Key/控制台会话与Origin检查。网页不会取得OAuth Token。转换中的任何数据库错误会回滚整个事务。

## 当前兼容边界

- 巴西支持候选资料、官方本地类目查询和工作表导出。现有发布链路仍只支持MLM/MCO/MLC；转入MLB返回明确的阻塞项。
- 本地类目查询不验证竞品实际类目、CBT映射或Child PK。导入的研究结论不能被伪装成官方核验。正式草稿不复用这些记录作为UP发布许可，继续要求现有类目评估与远程预检。
- 地方语言内容保留在候选中；现有Family发布接口继续使用共用英文描述，未新增站点刊登内容更新API。
- 不同SKU实际包装重量写入对应variant。独立尺寸、材质及来源保存在候选和正式事实库中；转换不会猜测平台属性ID，必须在正式草稿根据类目属性完成映射。
- 可用HTTPS图片注册为待审核外部图片；仍需现有图片审核/美客多上传步骤。既有主图独占规则保持，尺寸SKU复用主图暂需在正式审核中处理。
- 工作表包含商品、站点类目、SKU、参数来源、图片、校验结果。它不是妙手上传模板；尚需取得真实模板、完成适配并实际导入验证。
- 本版不抓取竞品、不调用收费AI、不自动定价，不发送任何刊登API请求。

## 部署与验证

发布前运行 `npm run db:migrate`，新增 `010_candidates.sql`。不删除或改写已有商品，正式发布开关沿用现有配置。

`npm test`覆盖参考事实拦截、SKU独立覆盖、过期类目、规格能力、类目命名空间、六Sheet导出，以及在隔离PostgreSQL引擎中从迁移、导入、网页编辑到事务转换的闭环。官方接口在测试中使用固定响应；真实账号类目和在线部署需另外验证。
