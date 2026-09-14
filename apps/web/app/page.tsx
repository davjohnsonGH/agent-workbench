import styles from "./page.module.css";

export default async function Home() {
  return (
    <main className={styles.container}>
      <h1 className={styles.title}>Hello Agent</h1>
      <div className={styles.stats}></div>
    </main>
  );
}
