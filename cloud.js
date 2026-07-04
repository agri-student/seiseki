/**
 * オンライン連携モジュール(Firebase)
 *
 * firebase-config.js が存在するときだけ有効になる。
 * 無ければ「cloud-disabled」イベントを出して、アプリはローカルのみで動き続ける。
 * 有効になると window.Cloud を定義して「cloud-ready」イベントを出す。
 */
const FB = "https://www.gstatic.com/firebasejs/10.12.2";

async function init() {
  let config;
  try {
    config = (await import("./firebase-config.js")).default;
  } catch {
    document.dispatchEvent(new CustomEvent("cloud-disabled"));
    return;
  }

  const [appMod, authMod, fsMod, stMod] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
    import(`${FB}/firebase-storage.js`),
  ]);

  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const storage = stMod.getStorage(app);

  const userDoc = (uid) => fsMod.doc(db, "users", uid);
  const printDoc = (uid, id) => fsMod.doc(db, "users", uid, "prints", id);
  const printRef = (uid, id) => stMod.ref(storage, `users/${uid}/prints/${id}`);

  window.Cloud = {
    enabled: true,

    get user() {
      return auth.currentUser;
    },

    onAuth(cb) {
      authMod.onAuthStateChanged(auth, cb);
    },

    async signup(email, password) {
      await authMod.createUserWithEmailAndPassword(auth, email, password);
    },
    async login(email, password) {
      await authMod.signInWithEmailAndPassword(auth, email, password);
    },
    async loginGoogle() {
      await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
    },
    async logout() {
      await authMod.signOut(auth);
    },

    /** クラウド上の学習データ一式を取得(無ければnull) */
    async pull() {
      const snap = await fsMod.getDoc(userDoc(auth.currentUser.uid));
      return snap.exists() ? snap.data() : null;
    },

    /** 学習データ一式を保存 */
    async push(state) {
      await fsMod.setDoc(userDoc(auth.currentUser.uid), state);
    },

    /** プリントの実ファイルをStorageへ、メタデータをFirestoreへ */
    async uploadPrint(id, blob, meta) {
      const uid = auth.currentUser.uid;
      await stMod.uploadBytes(printRef(uid, id), blob, { contentType: meta.type });
      await fsMod.setDoc(printDoc(uid, id), meta);
    },

    async deletePrint(id) {
      const uid = auth.currentUser.uid;
      await fsMod.deleteDoc(printDoc(uid, id));
      try {
        await stMod.deleteObject(printRef(uid, id));
      } catch {
        /* すでに無い場合は無視 */
      }
    },

    /** 別端末など、ローカルに実ファイルが無いときの閲覧用URL */
    async printUrl(id) {
      return stMod.getDownloadURL(printRef(auth.currentUser.uid, id));
    },
  };

  document.dispatchEvent(new CustomEvent("cloud-ready"));
}

init();
