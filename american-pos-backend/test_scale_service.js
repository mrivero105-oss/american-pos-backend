const ScaleService = require('./services/ScaleService');

async function testScale() {
    console.log('--- Testing ScaleService ---');

    // 1. Test Frame parsing - Stable weight
    const stableFrame = 'ST,GS,+00.350kg\r\n';
    const parsedStable = ScaleService.parseScaleFrame(stableFrame);
    console.log('Parsed Stable Frame:', parsedStable);
    if (!parsedStable.isStable || parsedStable.weight !== 0.35 || parsedStable.unit !== 'kg') {
        throw new Error('Failed parsing stable frame');
    }

    // 2. Test Frame parsing - Unstable weight (in motion)
    const unstableFrame = 'US,GS,+00.345kg\r\n';
    const parsedUnstable = ScaleService.parseScaleFrame(unstableFrame);
    console.log('Parsed Unstable Frame:', parsedUnstable);
    if (parsedUnstable.isStable) {
        throw new Error('Failed detecting unstable weight');
    }

    // 3. Test listPorts
    const ports = await ScaleService.listPorts();
    console.log('Available Serial COM Ports:', ports);

    console.log('[PASS] ScaleService verification complete.');
    process.exit(0);
}

testScale().catch(e => {
    console.error('FAIL:', e);
    process.exit(1);
});
