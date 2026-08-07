/**
 * Prettier 统一格式化配置。
 *
 * singleQuote=false 会将 import/export 模块路径等字符串统一格式化为双引号，
 * 使项目内的模块引用风格保持一致。
 */
export default {
  singleQuote: false,
  trailingComma: "all",
  arrowParens: "avoid",
  printWidth: 120,
  semi: true,
  tabWidth: 2,
};
