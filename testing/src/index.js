import styles from "./styles.module.css";

console.log(styles.used);

function importFoo() {
  return import(/* webpackChunkName: "foo" */ "./foo");
}

// Prevent tree-shaking
window.importFoo = importFoo;
