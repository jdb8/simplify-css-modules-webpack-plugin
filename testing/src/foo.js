import styles from "./foo.module.css";
import sharedStyles from "./shared.module.css";

export default function foo() {
  console.log(styles.bye);
  console.log(sharedStyles["another-used-class"]);
}
