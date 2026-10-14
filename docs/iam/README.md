# IAM / OIDC ロール作成依頼・手順書（管理者向け）

対象アカウント: **646977526034** / リージョン: **ap-northeast-1** / リポジトリ: **gyokuou0836/SCN-GitOps**

> **このディレクトリは資料です**（`docs/iam/`）。デプロイワークフロー（`.github/workflows/deploy.yml`）からは参照されません。
> ワークフローが使うのは `infra/` の CDK コードだけです。
> `ntcs-wan` には IAM 権限が無いため、ロールの作成は**管理者が一度だけ**実施する作業です。

---

## なぜ新しいロールが必要か

| 項目 | 内容 |
|---|---|
| 既存ロール | `arn:aws:iam::646977526034:role/github-actions-s3-practice-deploy`（別リポジトリ `github_actions_for_aws` 用） |
| 問題 | 信頼ポリシーの `sub` が `repo:gyokuou0836@5299457/github_actions_for_aws@1416525375:environment:*` に限定されているため、**別リポジトリのワークフローからは引き受けられない** |
| 採る方針 | 既存ロールを書き換えず、**SCN-GitOps 専用のロールを新設**する（既存リポジトリ・既存スタックへ一切変更を加えない） |
| 代行不可の理由 | `ntcs-wan` は `NTCSDevGuardrailDenyPolicy` により IAM 変更（`iam:CreateRole` 等）が Deny |

---

## 提出用サマリ（このブロックをそのままチケット／チャットへ貼り付け可）

**【依頼】SCN-GitOps 用の GitHub OIDC デプロイロール新規作成**

| 項目 | 内容 |
|---|---|
| 宛先 | （管理者） |
| 依頼者 | （記入） |
| 期限 | （記入） |
| 優先度 | 中 |
| 対象 | アカウント `646977526034` / リージョン `ap-northeast-1` |
| 依頼内容 | CloudFormation スタック `github-oidc-scn-gitops-dev` を 1 回デプロイして、ロール **`github-actions-scn-gitops-deploy-dev`** を作成（所要 5 分） |
| 使用テンプレート | `docs/iam/github-oidc-role.yaml`（実在 ID を含まない雛形。値はパラメータで指定） |
| OIDC プロバイダ | **既存を利用**（`token.actions.githubusercontent.com` は作成済み）→ `CreateOidcProvider=false` |
| 信頼する `sub`（immutable） | `repo:gyokuou0836@5299457/SCN-GitOps@1418567377:environment:dev` |
| 付与する権限 | スタック `scn-gitops-s3-practice-dev` への CFN 操作（作成/更新/参照）と、バケット `scn-gitops-s3-practice-dev-646977526034` への S3 操作のみ |
| 実施方法 | 下記「実施コマンド」 |
| 完了条件 | 出力 `RoleArn` を依頼者へ連携（依頼者は GitHub の Environment secret に設定） |
| 影響範囲 | **新規リソースのみ**。既存ロール・既存スタック・他リポジトリへの変更なし |

> このリポジトリは `cdk bootstrap` を**使いません**（理由と実測は「bootstrap を使わない理由」を参照）。
> したがって依頼内容は「ロール 1 つを作る」だけです。

---

## 作成されるリソース

| リソース | 名前 | 備考 |
|---|---|---|
| IAM ロール | `github-actions-scn-gitops-deploy-dev` | GitHub OIDC の `environment:dev` からのみ引受け可能 |
| インラインポリシー | `scn-gitops-cdk-deploy` | CloudFormation（自リポジトリのスタック）と S3（同スタックが作るバケット）のみ |
| OIDC プロバイダ | （作成しない） | アカウントに既存のため `CreateOidcProvider=false` |

---

## 実施コマンド（管理者）

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

> `AWS::IAM::Role` を作るため `CAPABILITY_NAMED_IAM` が必要です（`iam:CreateRole` / `iam:PutRolePolicy` の権限も必要）。
> 出力の `RoleArn`（`arn:aws:iam::646977526034:role/github-actions-scn-gitops-deploy-dev`）を控えてください。

### 検証（管理者側）

```bash
# 信頼ポリシーの sub が immutable 形式になっているか
aws iam get-role --role-name github-actions-scn-gitops-deploy-dev \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals'

# 許可ポリシーの中身
aws iam get-role-policy --role-name github-actions-scn-gitops-deploy-dev \
  --policy-name scn-gitops-cdk-deploy
```

期待値:

```
{"token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
 "token.actions.githubusercontent.com:sub": ["repo:gyokuou0836@5299457/SCN-GitOps@1418567377:environment:dev"]}
```

## 依頼者側（リポジトリ管理者）の作業

| # | 作業 | 値 |
|---|---|---|
| 1 | Settings → Environments → **`dev`** を作成 | — |
| 2 | 環境 `dev` の **Secret** `AWS_ROLE_ARN` | 上で控えた `RoleArn` |
| 3 | 環境 `dev` の **Deployment branches** | `deploy_dev`（PR は `feature/*`） |
| 4 | デフォルトブランチ | `deploy_dev`（`main` は履歴用） |

> Secret 未設定／ロール未作成の状態で `deploy_dev` にマージすると、
> `configure-aws-credentials` が `Not authorized to perform sts:AssumeRoleWithWebIdentity` で失敗します
> （ワークフロー自体は `Debug OIDC Token Claims` ステップまで到達します）。

---

## bootstrap を使わない理由（実測・2026-10-14）

`ntcs-wan` の認証情報で実測した結果、**このアカウントでは CDK の既定（bootstrap 前提）のデプロイ方式が使えません**。

| 操作 | 結果 |
|---|---|
| `aws cloudformation describe-stacks --stack-name CDKToolkit` | **AccessDenied**（`NTCSDevGuardrailDenyPolicy` による明示 Deny） |
| `aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version` | **AccessDeniedException**（同ポリシー） |
| `aws cloudformation validate-template` / `list-stacks` | **AccessDenied** |
| `aws iam get-role` / `list-open-id-connect-providers` | **AccessDenied** |
| `aws s3 ls` | **AccessDenied**（`s3:ListAllMyBuckets`） |

CDK v2 の `DefaultStackSynthesizer`（既定）は、デプロイ時に次の bootstrap リソースを前提にします。

1. スタックテンプレートを `cdk-hnb659fds-assets-<account>-<region>` へアップロードし、`TemplateURL` で渡す
2. SSM `/cdk-bootstrap/hnb659fds/version` を読んで bootstrap 済みか検証する（未 bootstrap だと `SSM parameter ... not found. Has the environment been bootstrapped?` で失敗）
3. `cdk-hnb659fds-deploy-role-*` / `...-cfn-exec-role-*` を引き受ける

そこで本リポジトリは `infra/bin/app.ts` で **`LegacyStackSynthesizer`** を指定しています。
これは bootstrap リソースを使わず、テンプレートを `TemplateBody` で直接送信し、
**CLI が現在使っている認証情報（＝ GitHub OIDC で引き受けたロール）**でデプロイする方式です。

| 論点 | 既定（DefaultStackSynthesizer） | 採用（LegacyStackSynthesizer） |
|---|---|---|
| bootstrap（S3/ECR/5 ロール） | 必須 | 不要 |
| デプロイに使う権限 | bootstrap ロール（広い） | **このロール自身（狭い・最小権限）** |
| テンプレートの渡し方 | S3 へアップロード → `TemplateURL` | `TemplateBody`（インライン、51,200 バイト未満） |
| アセット（Lambda コード等） | 可 | 不可（本リポジトリでは未使用） |

---

## 権限の根拠（なぜこのアクションが必要か）

| アクション | 用途 |
|---|---|
| `cloudformation:CreateStack` / `UpdateStack` | `cdk deploy --method=direct` が直接呼ぶ（変更セットを作らない） |
| `cloudformation:DescribeStacks` | スタックの存在確認（CDK CLI が最初に呼ぶ） |
| `cloudformation:GetTemplate` | 変更が無い場合のデプロイ省略判定（no-op）と差分表示 |
| `cloudformation:DescribeStackEvents` | 進行状況の表示 |
| `cloudformation:ListStackResources` / `DescribeStackResources` | デプロイ後の状態表示・失敗時の診断 |
| `s3:CreateBucket` / `PutBucket*` / `GetBucket*` / `ListBucket` | スタックが作る練習用バケットの設定（CloudFormation は呼び出し元の権限でリソースを作成する） |

**意図的に付けていない**権限:

| アクション | 理由 |
|---|---|
| `cloudformation:CreateChangeSet` / `ExecuteChangeSet` | `--method=direct` では変更セットを作らない |
| `cloudformation:DeleteStack` | スタック削除は管理者が実施（CI からは消させない） |
| `iam:*` | スタックは IAM リソースを作らない（`iam:PassRole` も不要） |
| `ssm:*` | bootstrap 検証を行わない（`LegacyStackSynthesizer`） |
| `s3:DeleteBucket` / `s3:DeleteObject` | バケットは `RemovalPolicy.RETAIN`（スタック削除でも残す） |
| `s3:PutBucketPolicy` | スタックはバケットポリシーを作らない |

---

## `ntcs-wan` 側で確認できないこと

上表のとおり IAM / CloudFormation / SSM / S3 の参照系 API は `ntcs-wan` では **明示 Deny** されています。
そのため依頼者は自分でロールやスタックを確認できません。**検証は GitHub Actions のログで行います**。

| 確認したいこと | 確認方法 |
|---|---|
| ロールを引き受けられたか | `deploy` ジョブの `Show the assumed identity` の出力 |
| 送信されている `sub` が信頼ポリシーと一致するか | `Debug OIDC Token Claims` ステップの `sub` と `Show Expected OIDC Subject` の出力を比較 |
| デプロイ結果 | ジョブ末尾の `Show stack outputs`（`cdk-outputs.json`） |

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `configure-aws-credentials` が `Not authorized to perform sts:AssumeRoleWithWebIdentity` | ロール未作成、または `sub` 不一致。Actions ログの `sub` と信頼ポリシーを比較（immutable 形式か、`environment:` の値が一致しているか） |
| `AccessDenied` on `cloudformation:CreateStack` | `Resource` のスタック名が実際のスタック名と不一致（`scn-gitops-s3-practice-dev` であること） |
| `AccessDenied` on `s3:CreateBucket` | バケット名プレフィックス不一致（実際は `scn-gitops-s3-practice-dev-<account id>`） |
| `SSM parameter /cdk-bootstrap/... not found. Has the environment been bootstrapped?` | 既定シンセサイザに戻ってしまっている。`infra/bin/app.ts` の `LegacyStackSynthesizer` を確認 |
| `Template too large to deploy ("cdk bootstrap" is required)` | テンプレートが 51,200 バイト超。`LegacyStackSynthesizer` は S3 へアップロードしないため、この構成では非対応（スタックを分割する） |

---

## 影響範囲・ロールバック

| 項目 | 内容 |
|---|---|
| 影響するリソース | 新規の IAM ロール `github-actions-scn-gitops-deploy-dev` とインラインポリシー 1 つ（＋管理用スタック `github-oidc-scn-gitops-dev`） |
| 既存リソースへの影響 | なし（既存ロール `github-actions-s3-practice-deploy`、スタック `s3-practice-*` には触れない） |
| ロールバック | GitHub の `AWS_ROLE_ARN` を元に戻したうえで `aws cloudformation delete-stack --stack-name github-oidc-scn-gitops-dev --region ap-northeast-1` |
| ダウンタイム | なし |

---

## 参考: 環境を増やすとき

同じテンプレートをパラメータだけ変えてデプロイします（ID は不変なので書き換え不要）。

| 環境 | `EnvironmentName` | ロール名 | スタック名 |
|---|---|---|---|
| dev | `dev` | `github-actions-scn-gitops-deploy-dev` | `scn-gitops-s3-practice-dev` |
| staging | `staging` | `github-actions-scn-gitops-deploy-staging` | `scn-gitops-s3-practice-staging` |
| prod | `prod` | `github-actions-scn-gitops-deploy-prod` | `scn-gitops-s3-practice-prod` |

```bash
# staging を追加する例（管理者）
aws cloudformation deploy --region ap-northeast-1 \
  --stack-name github-oidc-scn-gitops-staging \
  --template-file docs/iam/github-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides EnvironmentName=staging CreateOidcProvider=false \
    GitHubOwner=gyokuou0836 GitHubOwnerId=5299457 \
    GitHubRepository=SCN-GitOps GitHubRepositoryId=1418567377 \
    StackNamePrefix=scn-gitops-s3-practice RoleNamePrefix=github-actions-scn-gitops \
    LocalUserName=ntcs-wan
```

> 併せて GitHub 側で Environment `staging`（Secret `AWS_ROLE_ARN`、Deployment branch `deploy_stg`）を作成します。
