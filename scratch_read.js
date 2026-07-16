const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/Users/mrive/AppData/Roaming/american-pos-backend/pos_v1.sqlite');

db.all("SELECT id, username, email, role, activeBranchId, companyId FROM Users", (err, users) => {
    if (err) console.error(err);
    console.log("Users:", JSON.stringify(users, null, 2));
    db.close();
});


