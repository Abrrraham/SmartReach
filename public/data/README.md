# Public Data Inputs

This folder stores local data files used by the app and offline scripts.

- `nanjing_poi.json`: Large POI dataset (do not commit; ignored by .gitignore).
- `nanjing_access_baseline.json`: Accessibility baseline used by the app (tracked).
- `type.xlsx`: Type dictionary used by `npm run type:report`.
- `type_rules.generated.json`: Generated rules file used by the POI classifier (tracked for convenience).

Generated outputs (not committed):
- `nanjing_access_baseline.report.json`
- `type_coverage_report.md`

To prepare data:
1. Place `nanjing_poi.json` here (or update `VITE_POI_URL`).
2. Place `type.xlsx` here for rule generation (or keep the tracked one).