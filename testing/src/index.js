import styles from "./styles.module.css";
import sharedStyles from "./shared.module.css";
import "./vendor.js";

console.log(styles.used);
console.log(sharedStyles["some-shared-class"]);

function importFoo() {
  return import(/* webpackChunkName: "foo" */ "./foo");
}

// Prevent tree-shaking
window.importFoo = importFoo;

window.alert(styles.someClass + styles.someClassWithASharedPrefix);
