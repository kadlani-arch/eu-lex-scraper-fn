import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = path.join(__dirname, 'results.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// Fonction utilitaire pour un délai
const delay = ms => new Promise(res => setTimeout(res, ms));

// Fonction pour charger les résultats existants
function loadExistingResults() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des résultats existants:', error.message);
    }
    return [];
}

// Fonction pour sauvegarder les résultats
function saveResults(results) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(results, null, 2), 'utf8');
        console.log(`Résultats sauvegardés dans ${DATA_FILE}. Total: ${results.length}`);
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des résultats:', error.message);
    }
}

// Fonction pour construire l'URL de recherche (la version de test)
function buildSearchUrl(pageNumber) {
    const today = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(today.getMonth() - 3);

    const pad = (num) => num.toString().padStart(2, '0');
    const dateFromFormatted = `${pad(threeMonthsAgo.getDate())}${pad(threeMonthsAgo.getMonth() + 1)}${threeMonthsAgo.getFullYear()}`;
    const dateToFormatted = `${pad(today.getDate())}${pad(today.getMonth() + 1)}${today.getFullYear()}`;

    const searchQuery1 = 'antidumping';
    const searchQuery2 = 'phosphate';
    const encodedQuery1 = encodeURIComponent(searchQuery1);
    const encodedQuery2 = encodeURIComponent(searchQuery2);

    const dateQuery = `ALL:${dateFromFormatted}|${dateToFormatted}`;
    const encodedDate = encodeURIComponent(dateQuery);
    
    const websiteUrl = `https://eur-lex.europa.eu/search.html?SUBDOM_INIT=ALL_ALL&DTS_SUBDOM=ALL_ALL&textScope0=ti-te&textScope1=ti-te&DTS_DOM=ALL&lang=en&type=advanced&andText0=${encodedQuery1}&andText1=${encodedQuery2}&date0=${encodedDate}&page=${pageNumber}`;
    return websiteUrl;
}

// Fonction pour scraper une seule page
async function scrapeSinglePage(pageNumber) {
    const websiteUrl = buildSearchUrl(pageNumber);
    console.log(`Scraping de la page ${pageNumber}...`);

    try {
        const response = await axios.get(websiteUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        const results = [];

        $('.SearchResult').each((_index, element) => {
            const resultElement = $(element);
            const titleLinkElement = resultElement.find('h2 a');
            const title = titleLinkElement.text().trim() || 'No Title Found';
            const link = `https://eur-lex.europa.eu${titleLinkElement.attr('href')}`;
            const internalIdElement = resultElement.find('.internalNum');
            const internalId = internalIdElement.text().trim() || 'No Internal ID Found';

            if (title && link && internalId) {
                results.push({ title, link, internalId });
            }
        });

        console.log(`Trouvé ${results.length} résultats sur la page ${pageNumber}.`);
        return results;
    } catch (error) {
        console.error(`Erreur lors du scraping de la page ${pageNumber}:`, error.message);
        return [];
    }
}

// Endpoint pour lancer le scraping et renvoyer les données
async function scrapeAndReturnResults(_req, res) {
    console.log('Démarrage du scraping et récupération des données...');
    
    const existingResults = loadExistingResults();
    const existingIds = new Set(existingResults.map(item => item.internalId));
    const newResults = [];
    let page = 1;

    try {
        while (true) {
            const pageResults = await scrapeSinglePage(page);
            if (pageResults.length === 0) {
                break;
            }

            let newResultsFoundOnPage = false;
            for (const result of pageResults) {
                if (!existingIds.has(result.internalId)) {
                    newResults.push(result);
                    existingIds.add(result.internalId);
                    newResultsFoundOnPage = true;
                }
            }
            
            if (!newResultsFoundOnPage && pageResults.length < 10) {
                 break;
            }

            // Ajouter un délai aléatoire entre 2 et 5 secondes
            await delay(Math.floor(Math.random() * 3000) + 2000);
            
            page++;
        }

        if (newResults.length > 0) {
            const updatedResults = [...existingResults, ...newResults];
            saveResults(updatedResults);
            return res.json({
                message: `${newResults.length} nouveaux documents ajoutés.`,
                totalResults: updatedResults.length,
                results: updatedResults
            });
        } else {
            console.log('Aucun nouveau document à ajouter.');
            return res.json({
                message: 'Aucun nouveau document à ajouter.',
                totalResults: existingResults.length,
                results: existingResults
            });
        }

    } catch (error) {
        console.error('Erreur lors du scraping:', error.message);
        return res.status(500).json({ message: 'Erreur lors de la récupération du site', error: error.message });
    }
}

// Définition des routes de l'API avec les chemins corrigés
app.get('/scrape-all-eurlex', scrapeAndReturnResults);
app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/demo', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});
app.get('/display-results', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});