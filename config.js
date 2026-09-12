// config.js - Konfigurasi Terpusat Enterprise (Bebas Cache)
const GlobalConfig = {
    // URL Worker & Firebase ditanam statis
    getWorkerUrl: () => "https://zeroix-gatekeeper.benak211.workers.dev",
    getFirebaseUrl: () => "https://cobaaja-ac5d0-default-rtdb.firebaseio.com",
    
    // Domain dipastikan bersih dari https://
    getPteroDomain: (mode = 'private') => {
        const domains = {
            private: "zerosystempriv.bypstar7.web.id",
            public: "assistantzeroix.bypstar7.online",
            public_v2: "zeropublikv2.bypstar7.online"
        };
        return domains[mode] || "localhost";
    },

    // Parameter statis default
    getDefaultDeploy: () => ({
        locationId: "1",
        eggId: "15",
        nodeId: "1",
        nestId: "5"
    })
};
