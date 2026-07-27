// config.js - Konfigurasi Terpusat Panel Center
const GlobalConfig = {
    getWorkerUrl: () => localStorage.getItem('cfg_worker_url') || "https://restless-truth-9b75.amisterious09.workers.dev/?",
    getFirebaseUrl: () => localStorage.getItem('cfg_firebase_url') || "https://cobaaja-ac5d0-default-rtdb.firebaseio.com",
    
    // Konfigurasi Pterodactyl berdasarkan divisi/mode
    getPteroConfig: (mode = 'private') => {
        if (mode === 'private') {
            return {
                domain: localStorage.getItem('prvt_domain') || "privateserverzeroix.bypstar7.web.id",
                api: localStorage.getItem('prvt_api') || "ptla_FN9WdJ1WzLH1BlGyzyeoWtZGDl9roNeAd8VVmz7g5tF"
            };
        } else {
            // Public & Public V2
            return {
                domain: localStorage.getItem('pub_domain') || "assistantzeroix.bypstar7.online",
                api: localStorage.getItem('pub_api') || "ptla_WlmF4CJ2yI68CQEKcFeDieij2gXE67CESbqGISbXOeB"
            };
        }
    },

    // Konfigurasi Default Deploy (Egg, Location, Node, Allocation)
    getDefaultDeploy: () => {
        return {
            locationId: localStorage.getItem('default_loc_id') || "1",
            eggId: localStorage.getItem('default_egg_id') || "15",
            nodeId: localStorage.getItem('default_node_id') || "1",
            nestId: localStorage.getItem('default_nest_id') || "5"
        };
    }
};
