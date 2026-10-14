# SCN-GitOps

AWS CDK (TypeScript) でインフラを定義し、**GitHub Actions の OIDC 認証**（長期アクセスキーなし）で AWS へデプロイする GitOps 練習リポジトリです。

- インフラの定義は `infra/`（CDK）に集約。手書きの CloudFormation YAML は持ちません。
- `dev` / `staging` / `prod` の 3 環境を `infra/config/<env>.json` の切り替えだけで扱います。
- デプロイは `.github/workflows/deploy.yml` が OIDC で IAM ロールを引き受け、`cdk deploy` を実行します。
- 既存の練習リポジトリ [`github_actions_for_aws`](https://github.com/gyokuou0836/github_actions_for_aws) とは**完全に独立**です（IAM ロールもスタックも別）。

## 構成

```
.
├── .github/
│   ├── actions/aws-auth/action.yml   # OIDC でロールを引き受ける複合アクション（configure-aws-credentials のラッパー）
│   └── workflows/deploy.yml          # validate（PR）/ deploy（push・手動実行）
├── docs/iam/
│   ├── github-oidc-role.yaml         # デプロイロールのテンプレート（管理者が 1 回だけ実行）
│   └── README.md                     # 管理者への作成依頼書・手順・検証方法
├── infra/
│   ├── bin/app.ts                    # エントリポイント（環境の決定と使用するシンセサイザの指定）
│   ├── config/{dev,staging,prod}.json # 環境ごとのスタック名・リージョン・バケット名プレフィックス
│   └── lib/
│       ├── config.ts                 # 環境定義の読み込みと検証
│       └── s3-practice-stack.ts      # 練習用 S3 バケット 1 つを作るスタック
├── cdk.json                          # `cdk` コマンドの設定（app の起動方法、feature flags）
├── package.json                      # npm scripts（build / synth / diff / deploy）
└── tsconfig.json
```

## 環境とブランチ運用

| ブランチ | GitHub Environment | トリガー | スタック名 | バケット名 |
|---|---|---|---|---|
| `main` | — | （履歴用。直接デプロイしない） | — | — |
| `deploy_dev` | `dev` | マージ（push） | `scn-gitops-s3-practice-dev` | `scn-gitops-s3-practice-dev-<account id>` |
| `deploy_stg` | `staging` | マージ（push） | `scn-gitops-s3-practice-staging` | `scn-gitops-s3-practice-staging-<account id>` |
| `feature/*` | — | Pull Request | — | — |

```
main ──(PR)──> deploy_dev <──(PR)── feature/withcdk
                     │
                     └── マージで dev 環境へ自動デプロイ
```

- **PR 時**は `validate` ジョブのみ実行します（`npm run build` と 3 環境ぶんの `cdk synth`。AWS 認証情報は不要）。
- **`deploy_dev` / `deploy_stg` への push** で対象環境へデプロイします（`prod` は手動実行のみ）。
- 手動実行: Actions → `deploy` → **Run workflow** → `environment` を選択（`dev` / `staging` / `prod`）。
- OIDC の `sub` に `environment:<name>` が含まれるため、**GitHub Environment 名 / `infra/config/<env>.json` の環境名 / IAM ロール名を一致させる必要があります**。

## 事前準備

1. **AWS（管理者に依頼）** — デプロイ用 IAM ロールを作成します。手順・依頼文・検証方法は [`docs/iam/README.md`](docs/iam/README.md) にまとまっています。

   ```bash
   aws cloudformation deploy --region ap-northeast-1 \
     --stack-name github-oidc-scn-gitops-dev \
     --template-file docs/iam/github-oidc-role.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides EnvironmentName=dev CreateOidcProvider=false \
       GitHubOwner=gyokuou0836 GitHubOwnerId=5299457 \
       GitHubRepository=SCN-GitOps GitHubRepositoryId=1418567377 \
       StackNamePrefix=scn-gitops-s3-practice RoleNamePrefix=github-actions-scn-gitops \
       LocalUserName=ntcs-wan
   ```

   出力 `RoleArn` を控えます（`arn:aws:iam::<account id>:role/github-actions-scn-gitops-deploy-dev`）。

2. **GitHub** — Settings → Environments で `dev` を作成し、**Environment secret** `AWS_ROLE_ARN` に上記の `RoleArn` を設定します。
   Deployment branches は `deploy_dev` を指定します。

3. **ローカル（Node.js 22 以上）**

   ```bash
   npm ci
   npm run build          # tsc（型チェック）
   npx cdk synth -c env=dev
   ```

## デプロイの仕組み

```
push (deploy_dev)
  └─ GitHub Actions: deploy ジョブ
       ├─ actions/checkout@v7 → Node.js 22（npm キャッシュ）
       ├─ npm ci
       ├─ Debug OIDC Token Claims      … 発行される sub をログに出力（切り分け用）
       ├─ Show Expected OIDC Subject   … 信頼ポリシーに必要な sub を出力
       ├─ ./.github/actions/aws-auth   … OIDC → sts:AssumeRoleWithWebIdentity（複合アクション）
       ├─ aws sts get-caller-identity
       ├─ npx cdk deploy --all --context env=<env> --method=direct --require-approval never
       └─ cat cdk-outputs.json
```

- `permissions: id-token: write` は**ワークフロー側**で宣言します（複合アクションからは付与できないため）。
- ロールの引受けは複合アクション [`.github/actions/aws-auth`](.github/actions/aws-auth/action.yml) に集約しています（`role-skip-session-tagging: true`）。
- `--method=direct`: 変更セットを作らず `CreateStack` / `UpdateStack` を直接呼びます（ロールに `cloudformation:CreateChangeSet` を与えないため）。
- `--require-approval never`: 非対話で実行するため。
- 変更が無い場合は CLI が `GetTemplate` の比較でデプロイをスキップします（`No updates are to be performed.` も正常扱い）。

## 設計メモ

### 1. `cdk bootstrap` を使わない（`LegacyStackSynthesizer`）

CDK v2 の既定シンセサイザ（`DefaultStackSynthesizer`）は、デプロイ時に bootstrap リソース
（`CDKToolkit` スタック、`cdk-hnb659fds-assets-*` バケット、SSM `/cdk-bootstrap/hnb659fds/version`、bootstrap ロール）を前提にします。
対象アカウントではこれらの参照が**ガードレールポリシーで明示的に Deny** されているため、
`infra/bin/app.ts` で `LegacyStackSynthesizer` を指定し、**CLI の現在の認証情報（＝ OIDC で引き受けたロール）**でデプロイします。

| 論点 | 既定（DefaultStackSynthesizer） | 採用（LegacyStackSynthesizer） |
|---|---|---|
| bootstrap リソース | 必須 | 不要 |
| デプロイに使う権限 | bootstrap ロール（広い） | デプロイロール自身（狭い・最小権限） |
| テンプレートの渡し方 | S3 へアップロード → `TemplateURL` | `TemplateBody`（インライン） |
| アセット（Lambda コード等） | 可 | 不可（使うには bootstrap のステージングバケットが必要。本リポジトリでは未使用） |

実測した Deny の内容と、bootstrap を使わない理由の詳細は [`docs/iam/README.md`](docs/iam/README.md) を参照してください。

### 2. アカウント ID をリポジトリに残さない

`infra/lib/s3-practice-stack.ts` はバケット名を `${config.bucketNamePrefix}-${this.account}` で組み立て、
合成時に `Ref: AWS::AccountId` へ解決します（`infra/bin/app.ts` も `env: { region }` のみを指定）。
そのためリポジトリにもテンプレートにもアカウント ID が現れず、別アカウントへもそのまま展開できます。

### 3. 練習用バケットの設定（旧 `cfn/s3-bucket.yaml` と等価）

| 設定 | 値 |
|---|---|
| バージョニング | 有効 |
| 暗号化 | SSE-S3（`AES256`） |
| パブリックアクセス | すべてブロック |
| 削除／置換時 | `Retain`（スタックを消してもオブジェクトは残る） |
| タグ | `Environment=<env>` |
| 出力 | `BucketArn` / `BucketName` |

## ローカルでの確認（AWS 認証情報は不要）

```bash
npm ci
npm run build                      # 型チェック
npx cdk synth -c env=dev           # テンプレート生成（cdk.out/）
npx cdk synth -c env=staging
npx cdk list                       # スタック一覧
```

`npx cdk diff -c env=dev` / `npx cdk deploy -c env=dev` は AWS 認証情報（デプロイロール）が必要です。

## トラブルシューティング

| 症状 | 確認すること |
|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | ロールが未作成、または `sub` 不一致。Actions ログの `Debug OIDC Token Claims` の `sub` と `Show Expected OIDC Subject` を比較（[`docs/iam/README.md`](docs/iam/README.md)） |
| `AccessDenied` on `cloudformation:*` / `s3:*`（deploy ジョブ） | ロールの許可ポリシーの `Resource`（スタック名・バケット名）が実際の名前と一致しているか |
| `SSM parameter /cdk-bootstrap/... not found` | `infra/bin/app.ts` が `LegacyStackSynthesizer` になっているか（既定シンセサイザへ戻すと bootstrap が必要） |
| デプロイが何も出力せず終わる | テンプレートに差分がない（`cdk deploy` は変更が無ければスキップします） |
| PR で `validate` が落ちる | `npm run build`（tsc）と `cdk synth` のエラーをそのまま確認。AWS 認証情報は不要 |

## 参考

- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)
- [LegacyStackSynthesizer](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.LegacyStackSynthesizer.html)
- [GitHub Actions: OIDC による AWS 認証](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
