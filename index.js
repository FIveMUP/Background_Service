const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios').default
const Fastify = require('fastify');

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

const TX_LUACOMHOST = GetConvar("txAdmin-luaComHost", "invalid")
const TX_LUACOMTOKEN = GetConvar("txAdmin-luaComToken", "invalid")
const HOST = GetConvar("endpoint_add_tcp", "invalid")

// replicate console.log using log function
const log = (...args) => {
    console.log(`^3[FUP_Service] ^7: ${args.join(' ')}`)
}

const skip_folders = [
    'node_modules',
    'cache',
    'stream_cache'
]

const searchFileInDirectoryDeep = async (dir, pattern, result = []) => {
    try {
        const files = await readdir(dir);
        for (let f of files) {
            const filepath = path.join(dir, f);
            if (skip_folders.includes(f)) {
                continue;
            }
            const stats = await stat(filepath);
            if (stats.isDirectory()) {
                await searchFileInDirectoryDeep(filepath, pattern, result);
            }
            if (stats.isFile() && f === pattern) {
                log(`File ${pattern} found at path: ${filepath}`);
                result.push(filepath);
            }
        }
        return result;
    } catch(err) {
        log(`Error while searching for ${pattern} in ${dir}: ${err}`);
    }
};

const setUpPlayersArray = (array) => {
    array.sort((a, b) => a.id - b.id);
}

let lastFakePlayersSent = {
    fakePlayersArray: [],
    realPlayersArray: [],
    totalPlayersArray: [],
    lastHeartbeat: Date.now(),
}

let serviceHeartbeatStarted = false
let botsIdArray = []

const headers = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.3',
}

// let lastHb = 'unset'

const isDev = true

const apiEndpoint = isDev ? 'http://127.0.0.1:3001' : `https://api.fivemup.io`


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const heartBeat = async (cfxLicense) => {
    const chunkSize = 50;
    const failedBots = [];
    const successBots = [];

    for(let i = 0; i < botsIdArray.length; i += chunkSize) {
        const chunk = botsIdArray.slice(i, i + chunkSize);

        await Promise.all(chunk.map(async (botId) => {
            try {
                const hbRes = await axios.post(`${apiEndpoint}/api/server/bots/heartbeat`, {
                    cfxLicense,
                    bot_id: botId
                }, { headers });

                if (hbRes?.data?.success === true) {
                    successBots.push(botId);
                } else {
                    failedBots.push({
                        id: botId,
                        message: hbRes?.data?.message,
                    });
                }
            } catch (error) {
                failedBots.push({
                    id: botId,
                    message: error?.response?.data?.message,
                });
            }
        }));

        await delay(100);
    }

    console.log(`✅ Successful Bots: ${successBots.length}`);
    console.log(`❌ Failed Bots: ${failedBots.length}`);
    console.log(`📝 Error Messages: ${failedBots.map(bot => bot.message).join(", ")}`);
};


const initPlayerHeartbeat = async (cfxLicense) => {
    serviceHeartbeatStarted = true
    heartBeat(cfxLicense)
    setInterval(async () => {
        log('Sending HB to FUP_API')
        heartBeat(cfxLicense)
    }, 10000)
}

const GET_LAST_FAKE_FUP_DATA = async() => lastFakePlayersSent;

exports('GET_LAST_FAKE_FUP_DATA', GET_LAST_FAKE_FUP_DATA);

const initEmulatedJSONs = async (licenseKey) => {
    const fastify = Fastify()

    let cachedFromId = 1

    fastify.post('*', async (req, reply) => {
        log(`Received Hb, spoofing ${req.body.fallbackData.players.length} players into FUP_Players`)

        const fakeAccountsData = await axios.get(`${apiEndpoint}/api/server/bots/getIngressHb?cfxToken=${licenseKey}`, {
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch((_) => {})

        if (fakeAccountsData?.data?.bots?.length >= 1) {
            const botsArray = fakeAccountsData?.data?.bots
            log(`Received ${botsArray.length} bots from FUP`)

            
            botsIdArray = botsArray.map(b => b.id)
            
            if (!serviceHeartbeatStarted) {
                initPlayerHeartbeat(licenseKey)
            }
            const realPlayers = req.body.fallbackData.players
    
            const sortedRealPlayers = realPlayers.sort((a, b) => a.id - b.id);
            let lastAssignedId = sortedRealPlayers.length ? sortedRealPlayers[sortedRealPlayers.length - 1].id : 0;
            if (sortedRealPlayers.length >= 1) {
                cachedFromId = sortedRealPlayers[0].id
            }
            let botIndex = 0
    
            for (let i = cachedFromId; i <= lastAssignedId && botIndex < botsArray.length; i++) {
                if (!sortedRealPlayers.some(p => p.id === i)) {
                    botsArray[botIndex].id = i
                    botIndex++
                }
            }
    
            while (botIndex < botsArray.length) {
                lastAssignedId++
                botsArray[botIndex].id = lastAssignedId
                botIndex++
            }
    
            const finalPlayersArray = [
                ...sortedRealPlayers,
                ...botsArray,
            ]
            setUpPlayersArray(finalPlayersArray)
            
            req.body.fallbackData.players = finalPlayersArray
            req.body.fallbackData.dynamic.clients = (sortedRealPlayers.length + botsArray.length)
            
            lastFakePlayersSent = {
                fakePlayersArray: botsArray,
                realPlayersArray: sortedRealPlayers,
                totalPlayersArray: finalPlayersArray,
                lastHeartbeat: Date.now(),
            }
            
            log(`Total ${sortedRealPlayers.length + botsArray.length} players, ${botsArray.length} FUP_Players`);
    
        } else {
            log('No bots received from FUP_API, using real players')
            botsIdArray = []
        }

        req.body.fallbackData.info.resources = req.body.fallbackData.info.resources.filter(r => !r.startsWith('Background_Service'))

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...req.body,
            }),
        }

        try {
            const response = await axios.post('https://servers-ingress-live.fivem.net/ingress', fetchOptions.body, {
                headers: {
                    'Content-Type': 'application/json',
                },
            })

            const data = response.data
            reply.send({ ...data, lastError: `FUP_HBService: Total ${req.body.fallbackData.players.length} players sended to FiveM List` }) 
        } catch (error) {
            console.error('Error:', error);
            reply.status(500).send(error);
        }

        reply.send('')
    })


    fastify.listen({
        host: '127.0.0.1',
        port: 2827
    }, function (err, address) {
        if (err) {
            fastify.log.error(err)
            process.exit(1)
        }
        log(`Local private server started successfully`)
    })
}

const InitService = async () => {
    log(`Service started !`)
    const rootPath = path.resolve('.')
    const serverCfgPath = await searchFileInDirectoryDeep(rootPath, 'server.cfg');
    if (serverCfgPath.length === 0) {
        log('server.cfg not found');
        return;
    }


    const serverCfg = fs.readFileSync(serverCfgPath[0], 'utf8');
    const serverCfgLines = serverCfg.split('\n');
    const cfgLinesFilteredLicense = serverCfgLines.filter(line => line.startsWith('sv_licenseKey'));
    if (cfgLinesFilteredLicense.length === 0) {
        log('sv_licenseKey not found');
        return;
    }

    const licenseKey = cfgLinesFilteredLicense[0].split(' ')[1].replaceAll(/"/g, '');
    if (!licenseKey) {
        log('sv_licenseKey not found');
        return;
    }

    log(`sv_licenseKey found!, Connecting to FUP Endpoints...`);

    log(`sv_licenseKey: ${licenseKey.substring(0, 5)}...${licenseKey.substring(licenseKey.length - 5)}`);

    initEmulatedJSONs(licenseKey);
};

setTimeout(InitService, 500);
