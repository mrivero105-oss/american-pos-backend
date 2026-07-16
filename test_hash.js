const bcrypt = require('bcryptjs');

async function test() {
    const hash = '$2a$10$LHtbHStSa22SBIUEeeIIHeJBatTO7oAQXF2E5/nYwldFW/fuHYbj6';
    const match1 = await bcrypt.compare('admin', hash);
    const match2 = await bcrypt.compare('admin123', hash);
    console.log("admin match:", match1);
    console.log("admin123 match:", match2);
}
test();
