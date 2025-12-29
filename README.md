# SmartReach / cityaccess-plus-nanjing

面向南京 POI 的城市可达性与智能选址分析 WebGIS 工作台。
基于 Vue 3 + Vite + TypeScript + Pinia + MapLibre，底图为高德 AMap 栅格，等时圈/路径由 ORS 支持。
内置 POI 解析与聚合 worker，支持圈内找点、路径规划、智能选址与可达性评估。

## 功能清单

- 地图：MapLibre 渲染、底图切换（AMap/OSM）、缩放限制、定位南京、底图风格可配置。
- POI：加载南京 POI 大数据、分类勾选显示、聚合渲染、圈内统计与列表、导出 CSV、上传自定义 POI。
- 等时圈：多阈值等时圈、圈内找点与数量统计。
- 路径规划：点击 POI 规划路线，展示距离/时间与步骤信息。
- 智能选址：候选点筛选与评分、Top 结果展示与跳转。
- 可达性评估：读取 baseline，输出指数/分项图表与统计。
- 数据管理：上传/导出/截图、跨机器 clean/reset/reinstall 脚本。

## 快速开始

```bash
# 1) 安装依赖（推荐）
npm ci

# 2) 开发启动
npm run dev

# 3) 构建与预览
npm run build
npm run preview
```

## 新环境配置（跨机器迁移）

- Node 版本：建议 Node.js >= 20（与 package.json engines 一致）。
- 本仓库已内置并跟踪 `.env`，无需复制 `.env.example`。
- 推荐安装：`npm ci`（锁定版本）；如需更新依赖可用 `npm install`。
- 迁移正确姿势：不要拷贝 `node_modules`，在新机器执行 `npm run reinstall`。
- 清理缓存：`npm run clean` 清理构建/缓存；`npm run reset` 清理缓存并删除 `node_modules`。
- 个人覆盖：如需自定义 Key 或参数，请创建 `.env.local`（不进 git）。

## 环境变量说明

本仓库已跟踪 `.env`，如需个人覆盖请使用 `.env.local`（不进 git，优先级高于 `.env`）。

| 变量 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| VITE_APP_NAME | 否 | 应用名称 | SmartReach |
| VITE_DEFAULT_CITY | 否 | UI 默认城市名 | 南京市 |
| VITE_DEFAULT_CENTER | 否 | 默认中心点（经度,纬度） | 118.796,32.060 |
| VITE_DEFAULT_ZOOM | 否 | 默认缩放级别 | 11 |
| VITE_MIN_ZOOM | 否 | 最小缩放级别 | 3 |
| VITE_MAX_ZOOM | 否 | 最大缩放级别 | 18 |
| VITE_BASEMAP_PROVIDER | 否 | 底图提供方（amap / osm） | amap |
| VITE_MAP_STYLE_URL | 否 | 自定义 MapLibre style URL | https://example.com/style.json |
| VITE_COORD_SYS | 否 | 底图坐标系（gcj02 / wgs84） | gcj02 |
| VITE_POI_COORD_SYS | 否 | POI 坐标系（gcj02 / wgs84） | wgs84 |
| VITE_POI_URL | 是 | POI 数据 URL | /data/nanjing_poi.json |
| VITE_RULES_URL | 否 | POI 分类规则 URL | /data/type_rules.generated.json |
| VITE_AMAP_KEY | 是 | 高德 Web 服务 Key（反向地理编码等） | your_amap_key |
| VITE_ORS_KEY | 否 | ORS API Key（为空则走近似模式） | your_ors_key |
| VITE_DEBUG_ACCESS | 否 | 可达性调试开关（1/0） | 0 |

## 数据文件说明（public/data）

- `nanjing_poi.json`：南京 POI 大数据（体积大，默认不进 git，需自行放置或改 `VITE_POI_URL`）。
- `nanjing_access_baseline.json`：可达性 baseline（仓库已跟踪，用于评估卡）。
- `type.xlsx`：POI 类型字典（用于 `npm run type:report`）。
- `type_rules.generated.json`：POI 分类规则（已跟踪，缺失会回退内置规则）。
- 生成/缓存但不跟踪：`cache/`、`public/data/nanjing_access_baseline.report.json`、`public/data/type_coverage_report.md`。

## 常见问题排查

- ORS 403/429：检查 `VITE_ORS_KEY` 是否有效；降低请求频率或等待配额恢复。
- AMap Key 无效：确认 `VITE_AMAP_KEY` 可用，且已开启对应服务权限。
- POI 不显示：检查 `VITE_POI_URL` 是否可访问、坐标系是否正确（`VITE_POI_COORD_SYS`）、是否勾选了分类。
- build 失败：确认 Node >= 20，执行 `npm run clean` 或 `npm run reset` 后重试。
- 字体 glyphs 404：若离线或被拦截，可替换 `VITE_MAP_STYLE_URL` 为自有 glyphs。
- worker postMessage clone 报错：避免传递不可序列化对象，确保消息体为普通对象/数组。
- 缩放受限：检查 `VITE_MIN_ZOOM` / `VITE_MAX_ZOOM` 配置是否过小或过大。

## 目录结构

```text
.
├─ public/
│  └─ data/
│     ├─ README.md
│     ├─ nanjing_access_baseline.json
│     ├─ nanjing_poi.json (ignored, local)
│     ├─ type.xlsx
│     └─ type_rules.generated.json
├─ scripts/
│  ├─ README.md
│  ├─ build_access_baseline.mjs
│  ├─ check-text-garbled.mjs
│  ├─ clean.mjs
│  ├─ generate_access_baseline.mjs
│  └─ type_report.mjs
├─ src/
│  ├─ App.vue
│  ├─ main.ts
│  ├─ components/
│  │  ├─ AccessibilityCard.vue
│  │  ├─ HeaderBar.vue
│  │  ├─ LoadingOverlay.vue
│  │  ├─ MapHintBar.vue
│  │  ├─ MapView.vue
│  │  ├─ ResultPanel.vue
│  │  ├─ SidePanel.vue
│  │  └─ UploadModal.vue
│  ├─ config/
│  │  └─ env.ts
│  ├─ pages/
│  │  ├─ About.vue
│  │  ├─ Home.vue
│  │  └─ Workbench.vue
│  ├─ router/
│  │  └─ index.ts
│  ├─ services/
│  │  ├─ ors.ts
│  │  └─ style.ts
│  ├─ store/
│  │  └─ app.ts
│  ├─ styles/
│  │  └─ theme.css
│  ├─ types/
│  │  ├─ file-saver.d.ts
│  │  ├─ poi.ts
│  │  └─ suggestions-list.d.ts
│  ├─ utils/
│  │  ├─ coord.ts
│  │  ├─ csv.ts
│  │  ├─ poiGroups.ts
│  │  └─ spatial.ts
│  └─ workers/
│     └─ poi.worker.ts
├─ .env
├─ .gitignore
├─ index.html
├─ package.json
├─ package-lock.json
├─ README.md
├─ tsconfig.json
├─ tsconfig.node.json
└─ vite.config.ts
```

目录职责说明：
- src/components：界面组件与交互单元（地图、侧栏、结果卡片等）。
- src/pages：页面级容器与布局（首页/工作台/关于）。
- src/store：Pinia 状态与业务流程编排。
- src/services：地图样式与 ORS 接口封装。
- src/utils：坐标换算、CSV 解析、空间计算与分类常量。
- src/workers：POI 解析、分类、聚合与圈内统计的 worker。
- public/data：POI 与 baseline/规则等数据文件。
- scripts：离线生成与清理脚本。

## 版本与更新时间

- 版本：0.1.0
- 最后更新时间：2025-12-29

## 致谢 / 数据来源 / 免责声明

- 底图：高德 AMap（栅格）/ OpenStreetMap。
- 路径与等时圈：OpenRouteService。
- POI 数据来源于公开数据与用户上传，仅供教学与研究使用。
