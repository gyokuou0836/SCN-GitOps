import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

/** `S3PracticeStack` のプロパティ（環境定義をそのまま受け取る） */
export interface S3PracticeStackProps extends cdk.StackProps {
  /** `infra/config/<環境名>.json` から読み込んだ環境定義 */
  readonly config: EnvConfig;
}

/**
 * 練習用の S3 バケット 1 つを作成するスタック。
 *
 * 旧 `GithubAction4AWS` の `cfn/s3-bucket.yaml` と等価な設定にしてある。
 *
 * | CFN (`cfn/s3-bucket.yaml`)          | CDK (`S3PracticeStack`)                        |
 * | ----------------------------------- | ---------------------------------------------- |
 * | `BucketName: !Ref BucketName`       | `bucketName: '<prefix>-<アカウント ID>'`        |
 * | `VersioningConfiguration: Enabled`  | `versioned: true`                              |
 * | `SSEAlgorithm: AES256`              | `encryption: BucketEncryption.S3_MANAGED`      |
 * | `PublicAccessBlockConfiguration` 4項 | `blockPublicAccess: BlockPublicAccess.BLOCK_ALL` |
 * | `DeletionPolicy: Retain`            | `removalPolicy: RemovalPolicy.RETAIN`          |
 * | `UpdateReplacePolicy: Retain`       | 同上（CDK が両方を出力する）                     |
 * | `Tags: Environment`                 | `Tags.of(this).add('Environment', ...)`        |
 * | `Outputs: BucketArn`                | `CfnOutput(this, 'BucketArn')`                 |
 *
 * アカウント ID は `this.account` として参照し、合成時に `Ref: AWS::AccountId`
 * へ解決される（＝リポジトリにもテンプレートにもアカウント ID を残さない）。
 */
export class S3PracticeStack extends cdk.Stack {
  /** 作成したバケット（出力・検証・将来の拡張から参照する） */
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: S3PracticeStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.bucket = new s3.Bucket(this, 'PracticeBucket', {
      bucketName: `${config.bucketNamePrefix}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // スタック削除・プロパティ変更による置換でも実体を残す（旧テンプレートの Retain と同じ）
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // Retain と併用できないため明示的に無効化（誤削除の防止）
      autoDeleteObjects: false,
    });

    cdk.Tags.of(this).add('Environment', config.environment);

    new cdk.CfnOutput(this, 'BucketArn', {
      description: '作成された S3 バケットの ARN',
      value: this.bucket.bucketArn,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      description: '作成された S3 バケット名',
      value: this.bucket.bucketName,
    });
  }
}
