import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { S3PracticeStack } from '../lib/s3-practice-stack';

/** `--context env=<名前>` が指定されなかったときの既定環境 */
const DEFAULT_ENVIRONMENT = 'dev';

const app = new cdk.App({
  // このリポジトリは `cdk bootstrap` を実行しない。
  // （対象アカウントのガードレールは CDKToolkit スタックと /cdk-bootstrap/* の参照を明示的に Deny しており、
  //   bootstrap 用の共有リソース（S3/ECR/5 つの IAM ロール）も作らない方針のため）
  //
  // 既定の DefaultStackSynthesizer はデプロイ時に bootstrap リソースを前提にする:
  //   1. スタックテンプレートを cdk-hnb659fds-assets-* バケットへアップロードし TemplateURL で渡す
  //   2. SSM /cdk-bootstrap/hnb659fds/version を読んで bootstrap 済みか検証する
  //   3. cdk-hnb659fds-deploy-role-* などの bootstrap ロールを引き受ける
  // 未 bootstrap の環境では 1〜3 がいずれも失敗するため、既定シンセサイザは使えない。
  //
  // LegacyStackSynthesizer は bootstrap リソースに依存せず、テンプレートを TemplateBody で直接送信し、
  // CLI が現在使っている認証情報（＝ GitHub OIDC で引き受けたロール）でそのままデプロイする。
  // これにより、bootstrap なしで「デプロイ用ロール単体の権限」だけで完結する。
  // トレードオフ: アセット（Lambda のコード等）は CFN パラメータ経由の旧方式になり、
  // S3 へのアップロード先も自前で用意する必要がある（本リポジトリはアセットを使わない）。
  //
  // @see https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html
  // @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.LegacyStackSynthesizer.html
  defaultStackSynthesizer: new cdk.LegacyStackSynthesizer(),
});

// deploy.yml は `--context env=${TARGET_ENV}` を渡す。
// ローカルでも `npx cdk synth -c env=dev` のように明示できる。
const environment = (app.node.tryGetContext('env') as string | undefined) ?? DEFAULT_ENVIRONMENT;
const config = loadConfig(environment);

// スタック名 = 論理的な識別子（CDK 側で `cdk deploy` のセレクタにもなる）
new S3PracticeStack(app, config.stackName, {
  config,
  // アカウントは意図的に指定しない（合成時に `Ref: AWS::AccountId` として解決される）。
  // これによりリポジトリへアカウント ID を残さず、別アカウントへもそのまま展開できる。
  env: { region: config.awsRegion },
  description: `S3 practice bucket (${config.environment}) managed by SCN-GitOps`,
});
