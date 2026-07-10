# SUPER DODGEBALL – App Store 提出ガイド（Macなし運用）

ビルドはGitHub ActionsのmacOSランナーで行うため、Macは不要です。
このガイドの手順はあなたのApple Developerアカウントでの操作が必要なものだけをまとめています。

## 全体の流れ

```
[1] 証明書の作成（Windowsで可能）
[2] App IDの登録
[3] プロビジョニングプロファイルの作成
[4] App Store Connect APIキーの作成
[5] GitHubにSecretsを登録
[6] App Store Connectでアプリを作成
[7] GitHub Actionsでビルド → TestFlight
[8] ストア情報を入力して審査提出
```

---

## [1] Distribution証明書の作成（Windowsで可能）

Git Bash（このPCに入っています）で以下を実行:

```bash
# 秘密鍵とCSR（証明書署名要求）を作成
openssl genrsa -out dist.key 2048
openssl req -new -key dist.key -out dist.csr \
  -subj "/emailAddress=gameyu99@gmail.com/CN=Yu Game/C=JP"
```

1. https://developer.apple.com/account/resources/certificates/list を開く
2. 「+」→ **Apple Distribution** を選択 → 作成した `dist.csr` をアップロード
3. できた `distribution.cer` をダウンロード
4. Git Bashで `.p12` に変換（パスワードを決めて入力）:

```bash
openssl x509 -inform DER -in distribution.cer -out dist.pem
openssl pkcs12 -export -inkey dist.key -in dist.pem -out dist.p12
# → パスワードを設定（後でSecretsに登録する）
```

5. base64化（Secrets登録用）:

```bash
base64 -w 0 dist.p12 > dist.p12.b64
```

## [2] App IDの登録

1. https://developer.apple.com/account/resources/identifiers/list → 「+」→ App IDs → App
2. Bundle ID: **com.gameyu.superdodgeball**（Explicit）
3. Description: SUPER DODGEBALL
4. Capabilitiesは何もチェック不要 → 登録

## [3] プロビジョニングプロファイル

1. https://developer.apple.com/account/resources/profiles/list → 「+」
2. **App Store Connect**（Distribution）を選択
3. App ID: com.gameyu.superdodgeball → 証明書: [1]で作ったもの
4. 名前: `SuperDodgeball AppStore` ← この名前をSecretsにも使う
5. `.mobileprovision` をダウンロードして base64化:

```bash
base64 -w 0 SuperDodgeball_AppStore.mobileprovision > profile.b64
```

## [4] App Store Connect APIキー

1. https://appstoreconnect.apple.com/access/integrations/api → 「+」
2. 名前: `github-actions` / アクセス: **App Manager**
3. **Issuer ID**（ページ上部）と**キーID**をメモ
4. `.p8` ファイルをダウンロード（1回しかDLできないので保管）

## [5] GitHub Secrets の登録

https://github.com/gameyu99-ux/dodgeball-online/settings/secrets/actions → New repository secret で以下を登録:

| Secret名 | 値 |
|---|---|
| `APPLE_TEAM_ID` | Developer会員ページ右上のチームID（例: AB12CD34EF） |
| `IOS_DIST_CERT_P12` | dist.p12.b64 の中身 |
| `IOS_DIST_CERT_PASSWORD` | [1]で決めたパスワード |
| `IOS_PROVISIONING_PROFILE` | profile.b64 の中身 |
| `IOS_PROFILE_NAME` | `SuperDodgeball AppStore` |
| `ASC_KEY_ID` | [4]のキーID |
| `ASC_ISSUER_ID` | [4]のIssuer ID |
| `ASC_KEY_P8` | .p8ファイルの中身（テキストをそのまま貼る） |

## [6] App Store Connect でアプリ作成

1. https://appstoreconnect.apple.com → マイApp → 「+」→ 新規App
2. プラットフォーム: iOS / 名前: SUPER DODGEBALL（重複時は「SUPER DODGEBALL 3D」等）
3. プライマリ言語: 日本語 / バンドルID: com.gameyu.superdodgeball / SKU: superdodgeball

## [7] ビルド & TestFlight

1. GitHubリポジトリ → Actions → **iOS Build & TestFlight** → Run workflow
2. 成功すると自動でTestFlightにアップロードされる（処理に10〜30分）
3. App Store Connect → TestFlight → 自分のiPhoneにTestFlightアプリを入れて動作確認

## [8] 審査提出に必要なもの

- **スクリーンショット**: 6.7インチ(1290×2796)と6.5インチ(1284×2778)各1枚以上（実機/TestFlightで撮影）
- **プライバシーポリシーURL**: 必須。Firebase認証でメール・名前を扱うため。
  GitHub Pagesや https://dodgeball-online.onrender.com/privacy.html などでOK（作成を手伝えます）
- **App Privacyの申告**: 「連絡先情報 > メールアドレス（アカウント作成用）」を収集、と申告
- 説明文・キーワード・サポートURL

---

## ローカル開発メモ

- `dodgeball.html` を更新したら `node build-www.js` で www/ に反映（CIでは自動実行）
- アイコンを変えたい: `assets/icon-only.png`（1024×1024）を差し替えて `npx capacitor-assets generate --ios`
- Bundle ID や表示名: `capacitor.config.json`
