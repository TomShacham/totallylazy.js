import {assert} from 'chai';
import {File} from '../src/files';
import {runningInNode} from "../src/node";
import {sequence} from "../src/sequence";

describe("files", function () {
    before(function() {
        if (!runningInNode()) this.skip();
    });

    it('can return absolute path', function () {
        assert.strictEqual(new File('test/example/child.txt').absolutePath,
            `${File.workingDirectory.absolutePath}/test/example/child.txt`);
    });

    it('can return name', function () {
        assert.strictEqual(new File('test/example/child.txt').name, 'child.txt');
    });

    it('can list children', async () => {
        const size = await sequence(new File('test/example/').children()).size();
        assert.strictEqual(size, 2);
    });

    it('can tell if directory', async () => {
        assert(await new File('src').isDirectory);
    });

    it('can tell if file exists', async () => {
        assert(!await new File('some-random-file-that-does-not-exist').exists);
    });

    it('can list descendants', async () => {
        const size = await sequence(new File('test/example/').descendants()).size();
        assert.strictEqual(size, 3);
    });

    it('can get file content as bytes', async () => {
        const bytes:Uint8Array = await new File('build.ts').bytes();
        assert(bytes.length > 0);
    });

    it('can get file content as string', async () => {
        const content:string = await new File('build.ts').content();
        assert(content.length > 0);
    });
});