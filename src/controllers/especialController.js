const { sendErrorResponse } = require("../utils");
const axios = require("axios");
const cheerio = require("cheerio");
const { sessions } = require("../sessions");

/**
 * Especial a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and outcome of leaving the chat
 * @throws {Error} If chat is not a group
 */
const getGroupTypes = async (req, res) => {
  try {
    const url = "https://gruposwhats.app/";
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    const anchorNodes = $(
      "body > section:nth-of-type(1) > div > div:nth-of-type(1)"
    ).find("a");
    const options = anchorNodes
      .map((_, anchor) => {
        const href = $(anchor).attr("href");
        if (href) {
          return href.split("/").pop();
        }
      })
      .get();

    res.json({ success: true, options: options });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get a groups chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and outcome of leaving the chat
 * @throws {Error} If chat is not a group
 */
const getGroups = async (req, res) => {
  try {
    const { initialPage, finalPage, groupType } = req.body;
    const groups = [];
    let statusCounter = 1;
    let globalCounter = 1;

    for (let i = parseInt(initialPage); i <= parseInt(finalPage); i++) {
      try {
        const urlEscolhida = `https://gruposwhats.app/category/${groupType}?page=${statusCounter}`;
        const { data: htmlFiltrado } = await axios.get(urlEscolhida);
        const $filtered = cheerio.load(htmlFiltrado);

        const divNodeFiltrado = $filtered(
          "body > section:nth-of-type(2) > div > div"
        );
        const anchorNodesFiltrados = divNodeFiltrado.find("a");

        if (anchorNodesFiltrados.length) {
          let counterII = globalCounter;

          for (const anchor of anchorNodesFiltrados.toArray()) {
            const href = $filtered(anchor).attr("href");
            if (href) {
              const parts = href.split("/");
              const lastSegment = parts.pop();
              const group = await printWhatsAppGroupUrl(lastSegment);
              if (group) {
                groups.push(group);
              }
              counterII++;
            }
          }

          globalCounter = counterII;

          const nextPageNode = $filtered(
            'a:contains("Próxima"), a:contains("Next")'
          );
          if (nextPageNode.length !== 0) {
            statusCounter++;
          }
        } else {
          console.log("Nenhuma tag <a> encontrada na página filtrada.");
        }
      } catch (error) {
        console.log(`Erro: ${error.message}`);
      }
    }

    res.json({ success: true, groups });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

const printWhatsAppGroupUrl = async (lastSegment) => {
  const urlFiltradaWhatsapp = `https://gruposwhats.app/group/${lastSegment}`;
  let htmlWhatsapp = null;

  for (let i = 0; i < 5; i++) {
    try {
      const { data } = await axios.get(urlFiltradaWhatsapp);
      htmlWhatsapp = data;
      if (htmlWhatsapp) break;
    } catch (error) {
      console.log(`Erro ao buscar a página: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!htmlWhatsapp) {
    console.log("Não foi possível obter o conteúdo da página.");
    return null;
  }

  const $ = cheerio.load(htmlWhatsapp);

  try {
    const urlWhatsapp = $(
      "body > section:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > a"
    ).attr("data-url");
    const h5Text = $(
      "body > section:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > h5"
    ).text();

    return `Whatsapp group: ${urlWhatsapp}, Group name: ${h5Text}`;
  } catch (error) {
    console.log(`Erro ao extrair dados: ${error.message}`);
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a message to everyone in a group
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and outcome of leaving the chat
 * @throws {Error} If chat is not a group
 */
const sendMessageEveryoneGroup = async (req, res) => {
  try {
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || "localhost";
    const { groupLink, sendMessageTypeBody } = req.body;
    const headers = {
      Accept: "*/*",
      "x-api-key": process.env.API_KEY,
      "Content-Type": "application/json",
    };

    const sessionId = req.params.sessionId;

    const serverUrlJoinGroup = `http://${HOST}:${PORT}/groupChat/join/${sessionId}`;
    const { data: chatIdResponse } = await axios.post(
      serverUrlJoinGroup,
      { groupLink },
      { headers }
    );

    let stop = 0;
    const chatId = chatIdResponse.chat;
    const getParticipants = async () => {
      await sleep(1000);
      const serverUrlGetClassInfo = `http://${HOST}:${PORT}/groupChat/getClassInfo/${sessionId}`;
      const { data: groupDataResponse } = await axios.post(
        serverUrlGetClassInfo,
        { chatId },
        { headers }
      );
      const participants = groupDataResponse.chat.groupMetadata.participants;

      if (stop < 5 && participants.length <= 1) {
        stop++;
        return await getParticipants();
      } else {
        return participants;
      }
    };

    const participants = await getParticipants();
    const serverUrlSendMessage = `http://${HOST}:${PORT}/client/sendMessage/${sessionId}`;

    for (const participant of participants) {
      const participantId = participant.id._serialized;

      sendMessageTypeBody.chatId = participantId;

      try {
        await axios.post(serverUrlSendMessage, sendMessageTypeBody, {
          headers,
        });
      } catch (sendMessageError) {
        console.error(
          `Failed to send message to ${participantId}:`,
          sendMessageError.message
        );
      }
    }

    try {
      const serverUrlLeaveGroup = `http://${HOST}:${PORT}/groupChat/leave/${sessionId}`;
      await axios.post(serverUrlLeaveGroup, { chatId }, { headers });
    } catch (error) {
      console.log(error);
    }

    try {
      const serverUrlDeleteChat = `http://${HOST}:${PORT}/chat/delete/${sessionId}`;
      await axios.post(serverUrlDeleteChat, { chatId }, { headers });
    } catch (error) {
      console.log(error);
    }

    res.json({ success: true, message: "All messages send with success" });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const extractAndCleanCellphoneNumbers = (htmlContent) => {
  const phonePattern = /\b(?:\(?\d{2}\)?\s?)?\d{5}[-.\s]?\d{4}\b/g;
  const matches = htmlContent.match(phonePattern);

  if (!matches) return [];

  const cleanedNumbers = new Set();
  matches.forEach((match) => {
    const cleanedNumber = match.replace(/\D/g, "");
    if (cleanedNumber.length === 11) {
      cleanedNumbers.add(cleanedNumber);
    }
  });

  return Array.from(cleanedNumbers).sort();
};

function isValidPhoneNumber(number) {
  // Função para validar o número de celular no formato esperado (11 dígitos)
  const phoneNumberPattern = /^\d{11}$/;
  return phoneNumberPattern.test(number);
}

/**
 * Scrape cellphone business numbers from Google Maps
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and the list of phone numbers
 * @throws {Error} If there's an error during the scraping process
 */
const scrapeCellphoneBusinessNumbersFromGoogleMaps = async (req, res) => {
  try {
    const { keywords } = req.body;

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No keywords provided" });
    }

    const headers = {
      Accept: "*/*",
      "x-api-key": process.env.API_KEY,
      "Content-Type": "application/json",
    };

    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || "localhost";

    const sessionId = req.params.sessionId;

    const allNumbers = new Set();

    const url = `http://${HOST}:${PORT}/client/isRegisteredUser/${sessionId}`;

    for (const keyword of keywords) {
      const mainUrl = `https://www.google.com.br/maps/search/${encodeURIComponent(
        keyword
      )}/@-23.6824124,-46.5952992,10z/data=!3m1!4b1?entry=ttu`;

      try {
        const response = await axios.get(mainUrl);
        const $ = cheerio.load(response.data);
        const htmlContent = $.html();
        const cellphoneNumbers = extractAndCleanCellphoneNumbers(htmlContent);

        for (const number of cellphoneNumbers) {
          if (isValidPhoneNumber(number)) {
            try {
              const postResponse = await axios.post(
                url,
                { number },
                { headers }
              );

              if (postResponse.data.result) {
                allNumbers.add("55" + number);
              }
            } catch (error) {
              if (error.message != "Request failed with status code 500") {
                console.error(`Failed to fetch URL ${url}:`, error.message);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Failed to fetch mainURL ${mainUrl}:`, error.message);
      }
    }

    res.json({ success: true, numbers: Array.from(allNumbers) });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get all phone numbers in group
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and outcome of leaving the chat
 * @throws {Error} If chat is not a group
 */
const getAllPhoneNumbersGroup = async (req, res) => {
  try {
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || "localhost";
    const { groupLink } = req.body;
    const headers = {
      Accept: "*/*",
      "x-api-key": process.env.API_KEY,
      "Content-Type": "application/json",
    };
    const sessionId = req.params.sessionId;

    const serverUrlJoinGroup = `http://${HOST}:${PORT}/groupChat/join/${sessionId}`;
    const { data: chatIdResponse } = await axios.post(
      serverUrlJoinGroup,
      { groupLink },
      { headers }
    );

    let stop = 0;
    const chatId = chatIdResponse.chat;
    const getParticipants = async () => {
      await sleep(1000);
      const serverUrlGetClassInfo = `http://${HOST}:${PORT}/groupChat/getClassInfo/${sessionId}`;
      const { data: groupDataResponse } = await axios.post(
        serverUrlGetClassInfo,
        { chatId },
        { headers }
      );
      const participants = groupDataResponse.chat.groupMetadata.participants;

      if (stop < 5 && participants.length <= 1) {
        stop++;
        return await getParticipants();
      } else {
        return participants;
      }
    };

    const participants = await getParticipants();

    const allNumbers = new Set();

    for (const participant of participants) {
      allNumbers.add(participant.id.user);
    }

    res.json({ success: true, numbers: Array.from(allNumbers) });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Send a bulk messages to everyone
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and the list of phone numbers
 * @throws {Error} If there's an error during the scraping process
 */
const sendBulkMessages = async (req, res) => {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || "localhost";
  const sessionId = req.params.sessionId;

  const serverUrlSendMessage = `http://${HOST}:${PORT}/client/sendMessage/${sessionId}`;

  const headers = {
    Accept: "*/*",
    "x-api-key": process.env.API_KEY,
    "Content-Type": "application/json",
  };

  try {
    const { cellphoneNumbers, sendMessageTypeBody } = req.body;

    if (!Array.isArray(cellphoneNumbers) || cellphoneNumbers.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No keywords provided" });
    }

    for (const cellphoneNumber of cellphoneNumbers) {
      sendMessageTypeBody.chatId = cellphoneNumber + "@c.us";

      try {
        await axios.post(serverUrlSendMessage, sendMessageTypeBody, {
          headers,
        });
      } catch (error) {
        console.error(
          `Failed to fetch URL ${serverUrlSendMessage}:`,
          error.message
        );
      }
    }

    res.json({ success: true, message: "All messages sent with success!" });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getGroupTypes,
  getGroups,
  sendMessageEveryoneGroup,
  scrapeCellphoneBusinessNumbersFromGoogleMaps,
  getAllPhoneNumbersGroup,
  sendBulkMessages,
};
