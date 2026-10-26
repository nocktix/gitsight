const GITHUB_REPO_URL_PATTERN =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export interface ParsedRepo {
  /** URL normalizada (sin espacios, sin .git ni barra final). */
  url: string;
  owner: string;
  repo: string;
  /** Identificador de la tarea: OWNER/<nombre de la tarea>. */
  taskId: string;
  /** Nombre del grupo: lo que sigue al nombre de la tarea en el repo. */
  group: string;
  /** true si la tarea salió de una tarea ya conocida (o fue indicada a mano); false si es una detección nueva. */
  taskIsKnown: boolean;
}

/** Parte "OWNER/<repo>" en la tarea y el grupo, si el repo empieza con `<tarea>-`. */
function splitByTask(owner: string, repo: string, taskId: string): string | null {
  const [taskOwner, taskName] = taskId.split("/");
  if (taskOwner !== owner || !taskName) return null;
  if (repo === taskName) return repo;
  return repo.startsWith(`${taskName}-`) && repo.length > taskName.length + 1
    ? repo.slice(taskName.length + 1)
    : null;
}

/**
 * Prefijo más largo (cortado en un guion) que `repo` comparte con otros repos ya cargados del
 * mismo owner. Siempre deja al menos un segmento para el grupo. null si no comparte ninguno.
 */
function commonPrefix(owner: string, repo: string, loadedUrls: string[]): string | null {
  const mine = repo.split("-");
  let best = 0;
  for (const url of loadedUrls) {
    const m = GITHUB_REPO_URL_PATTERN.exec(url);
    if (!m || m[1] !== owner || m[2] === repo) continue;
    const other = m[2].split("-");
    let i = 0;
    while (i < Math.min(mine.length, other.length) - 1 && mine[i] === other[i]) i += 1;
    best = Math.max(best, i);
  }
  return best > 0 ? mine.slice(0, best).join("-") : null;
}

/**
 * Detecta tarea y grupo a partir de la URL del repo (GitHub Classroom: <tarea>-<equipo>).
 *
 * 1. Si el repo empieza con el identificador de una tarea conocida, usa esa tarea
 *    (la más larga si calzan varias): así funcionan los equipos con guion en el nombre.
 * 2. Si no, usa el prefijo común más largo con los repos ya cargados del mismo owner.
 * 3. Si no, quita el último segmento tras el guion. Sin guion, tarea y grupo son el repo completo.
 *
 * Los casos 2 y 3 son una suposición (`taskIsKnown: false`): el llamador debe pedir confirmación.
 *
 * `forcedTaskId` (corrección manual del evaluador) reemplaza la detección; si no es un prefijo
 * válido del repo, devuelve null.
 */
export function parseRepoUrl(
  input: string,
  knownTaskIds: string[] = [],
  forcedTaskId?: string,
  loadedUrls: string[] = [],
): ParsedRepo | null {
  const match = GITHUB_REPO_URL_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  const url = `https://github.com/${owner}/${repo}`;

  if (forcedTaskId !== undefined) {
    const group = splitByTask(owner, repo, forcedTaskId);
    return group === null
      ? null
      : { url, owner, repo, taskId: forcedTaskId, group, taskIsKnown: true };
  }

  const known = [...knownTaskIds]
    .sort((a, b) => b.length - a.length)
    .find((id) => splitByTask(owner, repo, id) !== null);
  if (known) {
    return {
      url,
      owner,
      repo,
      taskId: known,
      group: splitByTask(owner, repo, known) as string,
      taskIsKnown: true,
    };
  }

  const shared = commonPrefix(owner, repo, loadedUrls);
  if (shared) {
    return {
      url,
      owner,
      repo,
      taskId: `${owner}/${shared}`,
      group: repo.slice(shared.length + 1),
      taskIsKnown: false,
    };
  }

  const cut = repo.lastIndexOf("-");
  const hasGroup = cut > 0 && cut < repo.length - 1;
  return {
    url,
    owner,
    repo,
    taskId: `${owner}/${hasGroup ? repo.slice(0, cut) : repo}`,
    group: hasGroup ? repo.slice(cut + 1) : repo,
    taskIsKnown: false,
  };
}
