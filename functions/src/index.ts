/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from "firebase-functions";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

import axios from "axios";
import * as functions from "firebase-functions/v2";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

/**
 * アプリから送られてくるデータの型定義
 */
interface GetGithubTokenData {
  code: string;
}

/**
 * GitHubからアクセストークンを取得する関数
 */
export const getGithubToken = functions.https.onCall<GetGithubTokenData>(
  {
    // Secret Managerから取得するキーを指定
    secrets: ["GITHUB_CLIENT_SECRET"],
    // 日本のリージョン(東京)に設定する場合 (任意)
    region: "asia-northeast1",
  },
  async (request: CallableRequest<GetGithubTokenData>) => {
    const { code } = request.data;

    if (!code) {
      throw new HttpsError("invalid-argument", "The function must be called with a 'code' argument.");
    }

    try {
      const response = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: "あなたのGITHUB_CLIENT_ID", // 本番用のIDを入力
          client_secret: process.env.GITHUB_CLIENT_SECRET, // Firebaseが自動注入
          code: code,
        },
        {
          headers: { Accept: "application/json" },
        }
      );

      // response.data には access_token, token_type, scope などが含まれます
      return response.data;
    } catch (error) {
      console.error("GitHub Auth Error:", error);
      throw new HttpsError("internal", "Failed to exchange code for token.");
    }
  }
);