# Public Data Inputs

This folder stores local data files used by the app.

- `nanjing_poi.json`: Large POI dataset (do not commit; ignored by .gitignore).
- `type.xlsx`: Type dictionary used by `npm run type:report` to generate rules.

To prepare data:
1. Place `nanjing_poi.json` here (or update `VITE_POI_URL`).
2. Place `type.xlsx` here for rule generation.

Generated files (not committed):
- `type_rules.generated.json`
- `type_coverage_report.md`
