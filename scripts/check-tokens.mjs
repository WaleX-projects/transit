import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC_DIR = path.resolve('src');
const ALLOWED_FILES = new Set([
  path.resolve('src/theme.ts'),
  path.resolve('src/tokens.ts'),
]);

const STYLE_PROPERTIES = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal', 'paddingVertical',
  'top', 'bottom', 'left', 'right', 'start', 'end',
  'gap', 'rowGap', 'columnGap',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
  'fontSize', 'lineHeight', 'letterSpacing',
  'elevation', 'shadowRadius',
  'size',
]);

const HEX_REGEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;

function collectFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = collectFiles(SRC_DIR);
const errors = [];

for (const file of allFiles) {
  if (ALLOWED_FILES.has(path.resolve(file))) continue;

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // Check 1: Disallow hex colors anywhere in the file
  lines.forEach((line, index) => {
    const matches = line.match(HEX_REGEX);
    if (matches) {
      for (const m of matches) {
        errors.push(`${path.relative(process.cwd(), file)}:${index + 1}: Hex color literal "${m}" found.`);
      }
    }
  });

  // Check 2: Disallow numeric style literals (other than 0 and 1)
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  function isStyleContext(node) {
    let curr = node.parent;
    while (curr) {
      // Direct JSX style attribute: style={{ ... }}
      if (ts.isJsxAttribute(curr)) {
        const name = curr.name.getText(sourceFile);
        if (name === 'style' || name === 'contentContainerStyle' || name === 'outlineStyle' || name === 'labelStyle') {
          return true;
        }
      }
      // StyleSheet.create({ ... })
      if (ts.isCallExpression(curr)) {
        const exprText = curr.expression.getText(sourceFile);
        if (exprText.includes('StyleSheet.create')) {
          return true;
        }
        // If it's a non-styling API call like resize({ width: 1280 }) or digest(), ignore
        if (exprText.endsWith('.resize') || exprText.endsWith('manipulate')) {
          return false;
        }
      }
      curr = curr.parent;
    }
    // If inside a component file and in a property assignment of style properties
    return true;
  }

  function checkNumericValue(node, propName) {
    let numVal = null;
    if (ts.isNumericLiteral(node)) {
      numVal = Number(node.text);
    } else if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    ) {
      numVal = -Number(node.operand.text);
    }

    if (numVal !== null && numVal !== 0 && numVal !== 1) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push(
        `${path.relative(process.cwd(), file)}:${line + 1}: Numeric style literal ${numVal} for "${propName}". Use tokens or 0/1.`
      );
    }
  }

  function isImageManipulatorResize(node) {
    const parentObj = node.parent;
    if (parentObj && ts.isObjectLiteralExpression(parentObj)) {
      const callExpr = parentObj.parent;
      if (callExpr && ts.isCallExpression(callExpr)) {
        const callee = callExpr.expression.getText(sourceFile);
        if (callee.includes('resize') || callee.includes('manipulate')) {
          return true;
        }
      }
    }
    return false;
  }

  function visit(node) {
    if (ts.isPropertyAssignment(node)) {
      const propName = node.name.getText(sourceFile).replace(/['"]/g, '');
      if (STYLE_PROPERTIES.has(propName)) {
        if (!isImageManipulatorResize(node) && isStyleContext(node)) {
          checkNumericValue(node.initializer, propName);
        }
      }
    } else if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile);
      if (STYLE_PROPERTIES.has(attrName) && node.initializer) {
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          checkNumericValue(node.initializer.expression, attrName);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (errors.length > 0) {
  console.error(`Token check failed with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(err);
  }
  process.exit(1);
} else {
  console.log('check-tokens: All files passed token and style checks.');
  process.exit(0);
}
