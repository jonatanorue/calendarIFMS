const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseMountInfo, storageCheck } = require("../storage.js");

// Trechos reais de /proc/self/mountinfo de um container Docker.
const root = "566 470 0:52 / / rw,relatime master:310 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A,upperdir=/var/lib/docker/overlay2/B/diff";
const proc = "567 566 0:55 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw";
const tmp = "580 566 0:60 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw,size=65536k";
const volume = "590 566 8:1 /var/lib/docker/volumes/calendario-data/_data /app/data rw,relatime - ext4 /dev/sda1 rw";

function check(lines, databasePath = "/app/data/calendar.db") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mountinfo-"));
  const file = path.join(directory, "mountinfo");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return storageCheck(databasePath, file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("lê o ponto de montagem e o tipo de cada linha", () => {
  assert.deepEqual(parseMountInfo([root, volume].join("\n")), [
    { mountPoint: "/", fsType: "overlay" },
    { mountPoint: "/app/data", fsType: "ext4" },
  ]);
});

test("banco num volume do Docker é persistente", () => {
  const result = check([root, proc, tmp, volume]);
  assert.equal(result.persistent, true);
  assert.equal(result.mountPoint, "/app/data");
});

test("banco no disco do próprio container some no próximo deploy", () => {
  const result = check([root, proc, tmp]);
  assert.equal(result.persistent, false);
  assert.equal(result.fsType, "overlay");
  assert.match(result.reason, /apagado no próximo deploy/);
});

test("banco em memória (tmpfs) também não é persistente", () => {
  assert.equal(check([root, tmp], "/tmp/calendar.db").persistent, false);
});

test("pasta com nome parecido não confunde a verificação", () => {
  assert.equal(check([root, volume], "/app/data2/calendar.db").persistent, false);
});

test("fora de Linux/container, informa que não foi possível verificar", () => {
  const result = storageCheck("/app/data/calendar.db", "/caminho/que/nao/existe");
  assert.equal(result.persistent, null);
});
