import * as fs from 'fs';
import * as path from 'path';

/**
 * 環境ごとのデプロイパラメータ（`infra/config/<環境名>.json`）。
 *
 * 値はここに集約し、スタック側には環境固有の値をベタ書きしない。
 * 別アカウント／別環境へ移す場合も、このファイルの中身だけで完結するようにしている。
 */
export interface EnvConfig {
  /** 環境名。deploy.yml の TARGET_ENV と OIDC の `environment:<name>` に一致させる */
  readonly environment: string;
  /** デプロイ先リージョン（IAM ロールの許可リージョンと一致させる） */
  readonly awsRegion: string;
  /** CloudFormation スタック名（IAM ポリシーの Resource と一致させる） */
  readonly stackName: string;
  /**
   * S3 バケット名のプレフィックス。
   * 実際のバケット名は `<prefix>-<AWS::AccountId>` になり、グローバル一意性を確保する
   * （アカウント ID は合成時の `Ref: AWS::AccountId` で解決するためリポジトリに残らない）。
   */
  readonly bucketNamePrefix: string;
}

/** 環境定義ファイルの置き場（このファイルは `infra/lib` にあるため 1 つ上が `infra`） */
const CONFIG_DIR = path.join(__dirname, '..', 'config');

const REQUIRED_KEYS: ReadonlyArray<keyof EnvConfig> = [
  'environment',
  'awsRegion',
  'stackName',
  'bucketNamePrefix',
];

/**
 * 環境定義ファイルを読み込んで検証する。
 *
 * `app.ts` から `--context env=<環境名>` で渡された値を解決する
 * （未指定時は `app.ts` 側の既定値）。
 *
 * @throws 定義ファイルが無い、または必須キーが空の場合
 */
export function loadConfig(environment: string): EnvConfig {
  const configPath = path.join(CONFIG_DIR, `${environment}.json`);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `環境定義ファイルが見つかりません: ${configPath}（指定された環境名: ${environment}）`,
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<EnvConfig>;

  for (const key of REQUIRED_KEYS) {
    if (!config[key]) {
      throw new Error(`環境定義ファイル ${configPath} に "${key}" が設定されていません`);
    }
  }

  return config as EnvConfig;
}
