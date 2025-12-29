# 可达性 baseline 离线生成脚本

本目录提供离线脚本，用于生成 `public/data/nanjing_access_baseline.json`，供前端可达性评价卡直接读取。

## 前置条件

- 配置 ORS Key：`ORS_KEY` 或 `VITE_ORS_KEY`
- POI 数据文件存在（默认）：`public/data/nanjing_poi.json`
- 可选分类规则：`public/data/type_rules.generated.json`（缺失会用内置规则）

## 快速开始

生成单个出行方式（默认步行）：

```bash
npm run baseline:build -- --profile foot-walking
```

或直接使用 Node：

```bash
node scripts/build_access_baseline.mjs --profile foot-walking
```

生成三套 baseline（步行/骑行/驾车）：

```bash
node scripts/build_access_baseline.mjs --profiles foot-walking,cycling-regular,driving-car
```

生成后默认输出：

- `public/data/nanjing_access_baseline.json`
- `public/data/nanjing_access_baseline.report.json`
- 缓存：`cache/ors_isochrones/`
- 断点续跑缓存：`cache/baseline_samples.jsonl`

## 常用参数

```bash
node scripts/build_access_baseline.mjs \
  --poi public/data/nanjing_poi.json \
  --out public/data/nanjing_access_baseline.json \
  --samples 250 \
  --gridKm 5 \
  --seed 42 \
  --profiles foot-walking,cycling-regular,driving-car \
  --thresholds 1,15,30,45,60 \
  --rps 1 \
  --coordSysPoi gcj02 \
  --resume true
```

参数说明：

- `--profiles` / `--profile`：出行方式（支持 `foot-walking`、`cycling-regular`、`driving-car`）
- `--samples`：采样点数量（建议 200~300）
- `--gridKm`：采样网格大小（公里）
- `--thresholds`：阈值分钟数组
- `--rps`：ORS 请求速率（避免 429）
- `--coordSysPoi`：POI 坐标系（`gcj02` 或 `wgs84`，必须与数据一致）
- `--resume`：断点续跑（默认 `true`）

## 注意事项

- ORS 有限流，若出现 429，可降低 `--rps` 或提高 `--retryDelay`。
- 若使用 `--profiles`，输出文件会包含 `byProfile`，前端会按 profile 自动匹配。
- 生成结果需满足单调性：`indexMean`、`categoryMean` 随阈值增加一般不下降。
