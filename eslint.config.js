import antfu from "@antfu/eslint-config";

export default antfu(
  {
    type: "lib",
    stylistic: false,
    typescript: true,
  },
  {
    ignores: ["dist", "node_modules"],
    rules: {
      "e18e/prefer-static-regex": "off",
      "jsonc/sort-array-values": "off",
      "jsonc/sort-keys": "off",
      "no-console": "off",
      "no-fallthrough": "off",
      "node/prefer-global/process": "off",
      "ts/explicit-function-return-type": "off",
    },
  },
);
