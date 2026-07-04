# Seiseki 📊 – 成績管理・学習支援アプリ

生徒が学習の記録・成績の管理・弱点の克服をひとつでできるWebアプリです。
**ローカルモード(サーバー不要)** と **オンラインモード(Firebase連携)** の2段階で動きます。

## 画面構成(6タブ)

| タブ | 機能 |
|---|---|
| 🏠 **ホーム** | 今週の勉強時間・次の提出物・目標達成率のタイル/進路アドバイス/得意・不得意レーダー/科目ごとの成績推移(得点率)グラフ/成績の追加 |
| ⏱️ **学習** | 学習タイマー(秒単位で自動記録)/手動の学習記録/提出物・課題の管理/学習の記録一覧 |
| 📚 **プリント** | 授業プリント・資料を科目ごとに保存(画像・PDF / 最大20MB)/**AIで問題をつくる**(オンライン時) |
| 📕 **弱点** | 弱点ノート。AI問題でまちがえた問題は自動でここに保存される |
| 👥 **フレンド** | フレンドコード/今週の勉強時間ランキング |
| ⚙️ **設定** | 学校・学年・科目/進路目標/週の目標時間/通知/アカウント(ログイン・同期)/データ書き出し |

## Q. データを貯めるのにFirebaseは必須?

**必須ではありません。** ローカルモードでも記録・成績・弱点はブラウザ(localStorage/IndexedDB)に蓄積され、
JSON書き出しでバックアップもできます。ただし次の機能には Firebase(またはそれに相当するサーバー)が必要です。

| 機能 | ローカルモード | オンラインモード |
|---|---|---|
| 記録・成績・弱点の蓄積 | ✅(この端末のみ) | ✅(クラウド同期) |
| 端末をまたいだ利用・機種変更 | JSON書き出しで手動 | ✅ 自動 |
| ブラウザのデータ消去に耐える | ❌ | ✅ |
| AIで問題をつくる | ❌ | ✅(Cloud Functions経由) |
| フレンドのランキング共有 | ❌(自分のみ表示) | 拡張で対応可 |

AI連携は「APIキーを生徒の端末に置かない」ためにサーバーが必須で、その役割をFirebase(Cloud Functions)が担います。

## 使い方(ローカルモード)

そのまま `index.html` を配信するだけで動きます。

```bash
npx serve .
# または
python3 -m http.server 8000
```

## オンラインモードのセットアップ(教員向け)

### 1. Firebaseプロジェクトの準備

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクトを作成
2. **Authentication** → ログイン方法で「メール/パスワード」(必要なら「Google」も)を有効化
3. **Firestore Database** と **Storage** を作成(ルールはこのリポジトリのものをデプロイするので初期値でOK)
4. プロジェクトの設定 → ウェブアプリを追加 → 構成オブジェクトをコピー
5. `firebase-config.example.js` を `firebase-config.js` という名前でコピーし、構成を貼りつける
   → これだけで設定タブに**ログイン欄**が現れ、記録がクラウド同期されるようになります

### 2. AI問題生成(Cloud Functions)のデプロイ

Cloud Functionsから外部API(Anthropic)を呼ぶため、**Blaze(従量課金)プラン**が必要です。

```bash
npm install -g firebase-tools
firebase login
firebase use <プロジェクトID>

# AIのAPIキーをSecret Managerへ(コードにもクライアントにも入らない)
firebase functions:secrets:set ANTHROPIC_API_KEY

cd functions && npm install && cd ..
firebase deploy   # Hosting + Firestoreルール + Storageルール + Functions
```

### 3. コストと安全の設定(重要)

- **回数制限**: `functions/index.js` の `DAILY_LIMIT`(既定: 1人1日5回)。サーバー側で数えるので改ざんできません
- **モデル**: `MODEL` 定数で切りかえ。品質重視 `claude-opus-4-8` / コスト重視 `claude-haiku-4-5`
- **支出上限**: [Anthropicコンソール](https://console.anthropic.com/)で月額上限とアラートを設定
- **Google Cloudの予算アラート**も設定推奨
- 生徒データの扱いは学校・教育委員会の規程(生成AIガイドライン)を確認のうえ運用してください

## セキュリティ設計

- AIのAPIキーは **Secret Manager にのみ** 保存(クライアント・リポジトリに含まれない)
- Firestore/Storageルールで「**自分のデータしか読み書きできない**」を強制(`firestore.rules` / `storage.rules`)
- AI利用回数は本人も書きかえ不可の `users/{uid}/private/` でサーバー管理
- 問題生成は**出題専用のシステムプロンプト+構造化出力(JSONスキーマ強制)**で、プリント内の指示文への追従(プロンプトインジェクション)や形式崩れを抑止
- 生成した問題には「AIが作った問題はまちがっていることがあります」を常に表示
- APIに送るのはプリントの中身だけで、氏名・成績などの個人情報は送りません

## ファイル構成

```
index.html        … 画面(6タブ+成績/AIクイズモーダル)
style.css         … スタイル
app.js            … アプリ本体(ローカルでも完結して動く)
cloud.js          … Firebase連携(firebase-config.jsがあるときだけ有効)
firebase-config.example.js … Firebase設定の見本
firebase.json     … Hosting / Firestore / Storage / Functions の設定
firestore.rules   … Firestoreセキュリティルール
storage.rules     … Storageセキュリティルール
functions/        … Cloud Functions(AI問題生成・回数制限)
```

## 今後の拡張アイデア

- フレンド申請とフレンド間ランキング(Firestoreに公開プロフィールを追加)
- AIによる進路アドバイス(現在は端末内の記録から生成する簡易版)
- 教員用ダッシュボード(クラスの学習時間・弱点の集計)
