// 環境変数ローダ: プロジェクトルートの .env と server/.env の両方を読む。
// どのディレクトリから起動しても単一のルート .env が効くようにする。
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(dir, '..', '.env') }); // リポジトリ直下の .env
dotenv.config({ path: path.join(dir, '.env') });        // server/.env（任意・上書きしない）
