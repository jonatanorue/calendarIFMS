// Verifica se a pasta do banco fica num disco que sobrevive a um novo deploy do container.
const fs = require("fs");
const path = require("path");

// Sistemas de arquivos que somem quando o container é recriado.
const ephemeralTypes = new Set(["overlay", "aufs", "tmpfs", "ramfs"]);

// Linha do /proc/self/mountinfo: "id pai maj:min raiz ponto-de-montagem opções ... - tipo origem ...".
function parseMountInfo(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [left, right = ""] = line.split(" - ");
      const fields = left.split(" ");
      return { mountPoint: fields[4]?.replace(/\\040/g, " "), fsType: right.split(" ")[0] };
    })
    .filter((mount) => mount.mountPoint && mount.fsType);
}

// O ponto de montagem mais específico que contém a pasta decide onde o arquivo vive.
function mountFor(directory, mounts) {
  return mounts
    .filter((mount) => directory === mount.mountPoint || directory.startsWith(mount.mountPoint.endsWith("/") ? mount.mountPoint : `${mount.mountPoint}/`))
    .sort((first, second) => second.mountPoint.length - first.mountPoint.length)[0] || null;
}

// persistent: true (volume ou disco próprio), false (some no próximo deploy) ou null (não deu para saber).
function storageCheck(databasePath, mountInfoPath = "/proc/self/mountinfo") {
  const directory = path.dirname(path.resolve(databasePath));
  let text;
  try {
    text = fs.readFileSync(mountInfoPath, "utf8");
  } catch {
    return { persistent: null, mountPoint: null, fsType: null, reason: "Não foi possível verificar (o servidor não roda em Linux/container)." };
  }
  const mount = mountFor(directory, parseMountInfo(text));
  if (!mount) return { persistent: null, mountPoint: null, fsType: null, reason: "Ponto de montagem não encontrado." };
  const persistent = !ephemeralTypes.has(mount.fsType);
  return {
    persistent,
    mountPoint: mount.mountPoint,
    fsType: mount.fsType,
    reason: persistent
      ? `A pasta ${directory} está num volume (${mount.fsType} em ${mount.mountPoint}).`
      : `A pasta ${directory} está no disco temporário do container (${mount.fsType}). O banco será apagado no próximo deploy.`,
  };
}

module.exports = { parseMountInfo, mountFor, storageCheck };
