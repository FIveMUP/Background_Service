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

const shufflePlayersArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

let serviceHeartbeatStarted = false
let botsIdArray = []

const headers = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.3',
}

// let lastHb = 'unset'

const heartBeat = async (cfxLicense) => {

    const failedBots = []
    const successBots = []

    botsIdArray.forEach((_, i) => {
        setTimeout(async () => {
            const hbRes = await axios.post(`https://api.fivemup.io/api/server/bots/heartbeat`, {
                cfxLicense,
                bot_id: botsIdArray[i],
            }, { headers }).catch((_) => {
                failedBots.push({
                    id: botsIdArray[i],
                    message: 'Failed to send HB',
                })
            })
            
            if (hbRes?.data?.success !== true) {
                failedBots.push({
                    id: botsIdArray[i],
                    message: hbRes?.data?.message,
                })
            } else if (hbRes?.data?.success === true) {
                successBots.push(botsIdArray[i])
            }
        }, 80 * i)  
    })

    // if (lastHb == 'unset' || lastHb + 60000 > Date.now()) {
        // lastHb = Date.now()
        setTimeout(() => {
            log(`✅ Successful Bots: ${successBots.length}`);
            log(`❌ Failed Bots: ${failedBots.length}`);
            log(`📝 Error Messages: ${failedBots.map(bot => bot.message).join(", ")}`);
        }, (botsIdArray.length * 80) + 1000);
    // }
}

const initPlayerHeartbeat = async (cfxLicense) => {
    serviceHeartbeatStarted = true
    heartBeat(cfxLicense)
    setInterval(async () => {
        log('Sending HB to FUP_API')
        heartBeat(cfxLicense)
    }, 10000)
}

const initEmulatedJSONs = async (licenseKey) => {
    const fastify = Fastify()

    let cachedFromId = 1

    fastify.post('*', async (req, reply) => {
        log(`Received Hb, spoofing ${req.body.fallbackData.players.length} players into FUP_Players`)

        const fakeAccountsData = await axios.get(`https://api.fivemup.io/api/server/bots/getIngressHb?cfxToken=${licenseKey}`, {
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
    
            // shufflePlayersArray(finalPlayersArray)
    
            // finalPlayersArray.forEach((p, i) => {
            //     p.id = i + 1
            // })
    
            req.body.fallbackData.players = finalPlayersArray
            req.body.fallbackData.dynamic.clients = (sortedRealPlayers.length + botsArray.length)
    
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
