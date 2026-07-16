const jwt = require('jsonwebtoken');
const http = require('http');

const secret = '<TU_SECRETO_JWT_SEGURO>';
const payload = {
    id: '2',
    companyId: '2',
    role: 'superadmin',
    email: 'mrivero105@gmail.com'
};

const token = jwt.sign(payload, secret, { expiresIn: '1h' });

const url = `http://localhost:5005/reports/bi/export?range=today&token=${token}`;

http.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:');
    console.log(JSON.stringify(res.headers, null, 2));
    
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        console.log('\nBody length:', body.length);
        console.log('First 200 chars of body:');
        console.log(body.substring(0, 200));
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
