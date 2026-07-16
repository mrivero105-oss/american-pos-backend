const { sequelize, connectDB } = require('./database/connection');

async function run() {
    await connectDB();
    try {
        const [users] = await sequelize.query("SELECT id, username, email, password FROM Users");
        console.log("Users:", users);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
