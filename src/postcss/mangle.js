const postcss = require("postcss");
const selectorParser = require("postcss-selector-parser");

const transform = (
  idGenerator,
  cssClasses,
  requiredPrefix,
  selectors,
  noMangle
) => {
  selectors.walkClasses(node => {
    if (node.type !== "class") {
      return node;
    }

    if (!node.value.startsWith(requiredPrefix)) {
      // If we don't see the required "magic prefix", we
      // know that this isn't a css module - just leave it alone
      return node;
    }

    // We're dealing with a css module: but make sure that
    // if we've already processed this selector, we re-use
    // the name rather than making 2+ different ones
    const oldClassName = node.value;

    // Replace with a leading _ to ensure that any possible classnames are valid
    const cleanName = oldClassName.replace(requiredPrefix, "_");
    const newClassName =
      cssClasses[oldClassName] || (noMangle ? cleanName : idGenerator());

    cssClasses[oldClassName] = newClassName;

    // Preserve the magic prefix for now, we'll remove it later
    node.value = `${requiredPrefix}${newClassName}`;
  });
};

module.exports = postcss.plugin("postcss-mangle-selectors", options => {
  const { idGenerator, cssClasses, requiredPrefix, disable } = options;
  const selectorTransformer = selectors =>
    transform(
      idGenerator,
      cssClasses,
      requiredPrefix,
      selectors,
      Boolean(disable)
    );
  return root => {
    root.walkRules(rule => {
      rule.selector = selectorParser(selectorTransformer).processSync(rule);
    });
  };
});
