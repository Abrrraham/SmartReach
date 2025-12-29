# SmartReach
基于POI数据的生活圈可达性分析与智能选址WebGIS系统

## 可达性基线生成（离线）

用于生成步行/骑行/驾车三套可达性基线数据（`byProfile`），供“可达性评价卡”进行同出行方式内部对比。

### 前置条件

- 配置 ORS Key：`VITE_ORS_KEY` 或 `ORS_KEY`
- 确认 POI 数据与分类规则文件存在：
  - `public/data/nanjing_poi.json`
  - `public/data/type_rules.generated.json`（可选，缺失会用内置规则）

### 生成命令

```bash
npm run baseline:generate
```

默认输出：`public/data/nanjing_access_baseline.generated.json`

### 常用参数

```bash
node scripts/generate_access_baseline.mjs \
  --samples 120 \
  --thresholds 1,15,30,45,60 \
  --profiles foot-walking,cycling-regular,driving-car \
  --delay 350 \
  --seed 42 \
  --cell 0.01 \
  --out public/data/nanjing_access_baseline.json
```

参数说明：
- `--samples`：采样点数量（越大越稳定，但请求更慢）
- `--thresholds`：阈值分钟数组（需 <= ORS 限制）
- `--profiles`：出行方式列表
- `--delay`：请求间隔（ms，避免触发限流）
- `--seed`：随机种子（可复现）
- `--cell`：网格索引大小（经纬度，默认 0.01）
- `--out`：输出文件路径

### 输出结构（摘要）

```json
{
  "version": 1,
  "city": "南京市",
  "thresholdsMin": [1, 15, 30, 45, 60],
  "byProfile": {
    "foot-walking": { "...": "baseline data" },
    "cycling-regular": { "...": "baseline data" },
    "driving-car": { "...": "baseline data" }
  }
}
```

如需直接替换线上基线数据，请将 `--out` 指向 `public/data/nanjing_access_baseline.json`。
