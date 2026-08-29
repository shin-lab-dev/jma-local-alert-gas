/**
 * ============================================================
 * 自分の地域の大雨・洪水に関する警報をメールで知らせるGAS
 * ============================================================
 *
 * 気象庁の「気象警報・注意報」データを定期的に確認し、
 * 指定した市区町村に
 *
 * ・大雨警報
 * ・大雨特別警報
 * ・洪水警報
 *
 * が発表され、状態が変化した場合にメールを送ります。
 *
 * 【重要】
 * このプログラムは気象庁などの公式な防災情報を代替するものではありません。
 * 実際の避難行動等については、自治体や気象庁から発表される
 * 最新の防災情報を必ず確認してください。
 *
 * Google Apps Script（GAS）の時間主導型トリガーで
 * 20分程度の間隔で実行することを想定しています。
 */


// ============================================================
// ▼▼▼ ここだけ、自分の情報・地域に変更してください ▼▼▼
// ============================================================

// 【1】通知を受け取るメールアドレス
const RECIPIENT_EMAIL = "ここにあなたのメールアドレス";

// 【2】都道府県名
const PREFECTURE_NAME = "福島県";

// 【3】市区町村名
const CITY_NAME = "福島市";

// 【4】気象庁の都道府県コード
const PREFECTURE_CODE = "070000";

// 【5】気象庁の市区町村コード
const CITY_CODE = "0720100";

// ============================================================
// ▲▲▲ 基本的に変更するのはここまでです ▲▲▲
// ============================================================


// 気象庁「気象警報・注意報」JSON
const JMA_WARNING_URL =
  `https://www.jma.go.jp/bosai/warning/data/warning/${PREFECTURE_CODE}.json`;


/**
 * 通知対象とする警報コード
 *
 * 03 : 大雨警報
 * 04 : 洪水警報
 * 33 : 大雨特別警報
 *
 * ※気象庁の仕様変更があった場合には、
 *   コードの見直しが必要になる可能性があります。
 */
const TARGET_WARNING_CODES = {
  "03": "大雨警報",
  "04": "洪水警報",
  "33": "大雨特別警報"
};


/**
 * メイン処理
 *
 * GASの時間主導型トリガーから、この関数を実行してください。
 */
function checkHeavyRainRisk() {

  try {

    // --------------------------------------------------------
    // 1. 気象庁から警報・注意報データを取得
    // --------------------------------------------------------

    const response = UrlFetchApp.fetch(
      JMA_WARNING_URL,
      { muteHttpExceptions: true }
    );

    if (response.getResponseCode() !== 200) {

      console.warn(
        "気象庁データの取得に失敗しました。HTTPステータス: "
        + response.getResponseCode()
      );

      return;
    }


    const data = JSON.parse(response.getContentText());


    // --------------------------------------------------------
    // 2. 指定した市区町村のデータを探す
    // --------------------------------------------------------

    const cityData = findAreaByCode(data, CITY_CODE);

    if (!cityData) {

      console.log(
        `${PREFECTURE_NAME}${CITY_NAME}（${CITY_CODE}）のデータが見つかりませんでした。`
      );

      return;
    }


    // --------------------------------------------------------
    // 3. 現在発表中の警報を取得
    // --------------------------------------------------------

    const currentWarnings = parseWarnings(cityData);


    // --------------------------------------------------------
    // 4. 大雨・洪水関係の警報があるか確認
    // --------------------------------------------------------

    const targetWarnings = currentWarnings.filter(
      warning => TARGET_WARNING_CODES[warning.code]
    );


    // --------------------------------------------------------
    // 5. 前回確認時の状態を取得
    // --------------------------------------------------------

    const scriptProperties =
      PropertiesService.getScriptProperties();

    const lastStatusKey =
      scriptProperties.getProperty("LAST_STATUS_KEY");


    /*
     * codeとstatusを組み合わせて、
     * 現在の警報状態を文字列として保存します。
     *
     * 例：
     * 03:発表,04:継続
     */
    const currentStatusKey = currentWarnings
      .map(warning => `${warning.code}:${warning.status}`)
      .sort()
      .join(",");


    // --------------------------------------------------------
    // 6. 前回から状態が変化した場合だけ処理
    // --------------------------------------------------------

    if (currentStatusKey !== lastStatusKey) {

      if (targetWarnings.length > 0) {

        sendNotificationEmail(
          data.reportDatetime,
          targetWarnings
        );

        console.log(
          `${PREFECTURE_NAME}${CITY_NAME}の大雨・洪水関係の警報をメール送信しました。`
        );

      } else {

        console.log(
          "警報情報は更新されましたが、通知対象の警報はありません。"
        );
      }


      // 現在の状態を保存
      scriptProperties.setProperty(
        "LAST_STATUS_KEY",
        currentStatusKey
      );

    } else {

      console.log(
        "前回確認時から警報状態の変化はありません。"
      );
    }


  } catch (error) {

    console.error(
      "エラーが発生しました: " + error.toString()
    );
  }
}


/**
 * JSONから指定した市区町村コードを探します。
 */
function findAreaByCode(jsonData, areaCode) {

  if (!jsonData.areaTypes) {
    return null;
  }


  for (const areaType of jsonData.areaTypes) {

    if (!areaType.areas) {
      continue;
    }


    for (const area of areaType.areas) {

      if (area.code === areaCode) {
        return area;
      }
    }
  }


  return null;
}


/**
 * 現在発表中の警報・注意報を取得します。
 *
 * 「解除」は除外します。
 */
function parseWarnings(areaData) {

  const warnings = [];


  if (!areaData.warnings) {
    return warnings;
  }


  for (const warning of areaData.warnings) {

    if (
      warning.status !== "解除" &&
      warning.status !== "発表警報・注意報はなし"
    ) {

      warnings.push({
        code: warning.code,
        status: warning.status
      });
    }
  }


  return warnings;
}


/**
 * メールを送信します。
 */
function sendNotificationEmail(
  reportDatetime,
  warningsList
) {

  const formattedTime =
    new Date(reportDatetime).toLocaleString(
      "ja-JP",
      { timeZone: "Asia/Tokyo" }
    );


  const warningText = warningsList
    .map(warning => {

      const warningName =
        TARGET_WARNING_CODES[warning.code]
        || `警報コード ${warning.code}`;

      return `・${warningName}（${warning.status}）`;

    })
    .join("\n");


  const subject =
    `【防災通知】${CITY_NAME} 大雨・洪水情報（${formattedTime}時点）`;


  const body =

`${PREFECTURE_NAME}${CITY_NAME}の防災気象情報が更新されました。

大雨・洪水に関する警報が発表されています。

■ 対象地域
${PREFECTURE_NAME} ${CITY_NAME}

■ 発表・更新時刻
${formattedTime}

■ 発表中の情報
${warningText}


■ 気象庁 防災情報
https://www.jma.go.jp/bosai/

最新の雨雲、キキクル、警報・注意報などを確認してください。


【注意】
このメールは、気象庁が公開しているデータを自動取得して
個人的に通知するためのものです。

このメールだけで避難等を判断せず、
気象庁、自治体などが発表する最新の防災情報を必ず確認してください。`;


  MailApp.sendEmail(
    RECIPIENT_EMAIL,
    subject,
    body
  );
}
