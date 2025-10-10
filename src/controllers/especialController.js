const { sendErrorResponse } = require("../utils");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const gerarNomeAleatorio = (tamanho = 10) => {
  return crypto.randomBytes(tamanho).toString("hex").slice(0, tamanho);
};

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
    const { data: html } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const $ = cheerio.load(html);

    // Agora com o seletor certo
    const anchorNodes = $("section.categories.bg-white div.col-category a.category");

    const options = anchorNodes.map((_, anchor) => {
      const href = $(anchor).attr("href");
      const name = $(anchor).find(".category-name").text().trim();

      if (href && name) {
        return {
          name,
          slug: href.split("/").pop(),
          url: href
        };
      }
    }).get();

    res.json({ success: true, count: options.length, options });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error.message);
    res.status(500).json({ success: false, error: error.message });
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

    for (let i = parseInt(initialPage); i <= parseInt(finalPage); i++) {
      const url = `https://gruposwhats.app/category/${groupType}?page=${i}`;
      console.log("📄 Buscando página:", url);

      const { data: html } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      const $ = cheerio.load(html);

      // Pega cada card de grupo
      const cards = $("section.section-groups .col-group .card.group");

      for (const card of cards.toArray()) {
        const name = $(card).find(".card-title").text().trim();
        const description = $(card).find(".card-text").text().trim();
        const image = $(card).find(".card-img-top").attr("src");
        const category = $(card).find(".card-category").text().trim();
        const groupPageUrl = $(card).find("a.btn-success").attr("href");

        if (!groupPageUrl) continue;

        try {
          // Abre a página do grupo para extrair o link real do WhatsApp
          const { data: groupHtml } = await axios.get(groupPageUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
          });
          const $$ = cheerio.load(groupHtml);

          // Seleciona o botão “Entrar no Grupo”
          const joinButton = $$("#entrar > div > div > a.btn-success");

          const whatsappUrl = joinButton.attr("data-url");
          const joinHref = joinButton.attr("href");
          const groupId = joinButton.attr("data-id");

          groups.push({
            id: groupId || null,
            name,
            category,
            description,
            image,
            page: groupPageUrl,
            joinPage: joinHref,
            whatsappUrl
          });

          console.log(`✅ ${name} → ${whatsappUrl}`);
        } catch (err) {
          console.warn(`Erro ao abrir grupo ${groupPageUrl}:`, err.message);
        }

        // Pequeno delay entre requests (evita bloqueio)
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    res.json({ success: true, count: groups.length, groups });
  } catch (error) {
    console.error("❌ Erro geral:", error.message);
    res.status(500).json({ success: false, error: error.message });
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

    try {
      const serverUrlLeaveGroup = `http://${HOST}:${PORT}/groupChat/leave/${sessionId}`;
      await axios.post(serverUrlLeaveGroup, { chatId }, { headers });
    } catch (error) {
      console.log(error);
    }

    res.json({ success: true, numbers: Array.from(allNumbers) });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res
      .status(500)
      .json({ success: false, message: error.message, especialCode: "pass" });
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
const getNumbersToType = async (req, res) => {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || "localhost";
  const sessionId = req.params.sessionId;
  const { initialPage, finalPage, groupType } = req.body;

  const getGroupsURL = `http://${HOST}:${PORT}/especial/getGroups/${sessionId}`;
  const getGroupNumbersURL = `http://${HOST}:${PORT}/especial/getAllPhoneNumbersGroup/${sessionId}`;

  const headers = {
    Accept: "*/*",
    "x-api-key": process.env.API_KEY,
    "Content-Type": "application/json",
  };

  const allNumbers = new Set();

  try {
    const groupsList = await axios.post(
      getGroupsURL,
      { initialPage, finalPage, groupType },
      {
        headers,
      }
    );

    const groups = groupsList.data.groups;

    const nomeAleatorio = gerarNomeAleatorio();
    const currentDir = __dirname;
    const fileName = `../../csvs/${nomeAleatorio}.csv`;
    const filePath = path.join(currentDir, fileName);

    for (let i = 0; i < groups.length; i++) {
      const groupLink = groups[i].link;

      try {
        const numbersList = await axios.post(
          getGroupNumbersURL,
          { groupLink },
          {
            headers,
          }
        );

        const numbers = numbersList.data.numbers;

        for (let j = 0; j < numbers.length; j++) {
          allNumbers.add(numbers[j]);

          fs.appendFile(filePath, numbers[j] + "\n", (err) => {
            if (err) throw err;
            console.log("Número adicionado ao arquivo cell_numbers.txt");
          });
        }
      } catch (error) {
        console.log(
          `Erro ao obter números do grupo ${groupLink}:`,
          error.response?.data?.especialCode || error.message
        );
      }
    }

    res.json({ success: true, numbers: Array.from(allNumbers) });
  } catch (error) {
    console.log(
      "Erro ao obter a lista de grupos:",
      error.response?.data?.especialCode || error.message
    );
    res.status(500).json({
      success: false,
      message: "Erro ao processar a requisição.",
      numbersAfterBan: Array.from(allNumbers),
    });
  }
};

module.exports = {
  getGroupTypes,
  getGroups,
  sendMessageEveryoneGroup,
  scrapeCellphoneBusinessNumbersFromGoogleMaps,
  getAllPhoneNumbersGroup,
  sendBulkMessages,
  getNumbersToType,
};
