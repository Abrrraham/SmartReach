import fs from 'fs';
import path from 'path';

const ROOTS = ['src', 'public'];
const EXTENSIONS = new Set(['.vue', '.ts', '.json']);

const stringQuestionRe = /(['"])(?:(?!\1).)*\?\?+(?:(?!\1).)*\1/g;
const templateQuestionRe = />[^<]*\?\?+[^<]*</g;
const replacementChar = '\uFFFD';

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        return;
      }
      walk(fullPath, files);
      return;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  });
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const issues = [];
  const isVue = filePath.endsWith('.vue');
  const isJson = filePath.endsWith('.json');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.includes(replacementChar)) {
      issues.push({
        filePath,
        lineNumber,
        kind: 'replacement-char',
        snippet: line.trim()
      });
    }

    if (!isJson && stringQuestionRe.test(line)) {
      issues.push({
        filePath,
        lineNumber,
        kind: 'question-marks-in-string',
        snippet: line.trim()
      });
    }
    stringQuestionRe.lastIndex = 0;

    if (isVue) {
      const templateLine = line.replace(/{{[^}]*}}/g, '');
      if (templateQuestionRe.test(templateLine)) {
        issues.push({
          filePath,
          lineNumber,
          kind: 'question-marks-in-template',
          snippet: line.trim()
        });
      }
      templateQuestionRe.lastIndex = 0;
      return;
    }
    if (templateQuestionRe.test(line)) {
      issues.push({
        filePath,
        lineNumber,
        kind: 'question-marks-in-template',
        snippet: line.trim()
      });
    }
    templateQuestionRe.lastIndex = 0;
  });

  return issues;
}

function main() {
  const files = [];
  ROOTS.forEach((root) => {
    if (fs.existsSync(root)) {
      walk(root, files);
    }
  });

  const allIssues = files.flatMap(scanFile);
  if (!allIssues.length) {
    console.log('[lint:text] ok');
    return;
  }

  console.warn('[lint:text] possible garbled text detected:');
  allIssues.forEach((issue) => {
    console.warn(
      `- ${issue.filePath}:${issue.lineNumber} (${issue.kind}) ${issue.snippet}`
    );
  });
  process.exit(1);
}

main();
