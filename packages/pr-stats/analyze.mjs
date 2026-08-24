import { fetchPrDetails, fetchPrSizes } from './github.mjs';
import {
  FILE_BUCKETS,
  formatHoursOnly,
  LINE_BUCKETS,
  printHistogram,
  printQuantileStrips,
  printSizeStats,
  printSizeTimeline,
  printStats,
  weeksSuffix,
} from './report.mjs';
import { durationHours } from './time.mjs';
import { link } from './utils.mjs';

function analyzePr(pr, details, user) {
  if (!details) {
    return { kind: 'inaccessible', pr };
  }

  const requests = details.timelineItems.nodes
    .filter((node) => node?.requestedReviewer?.login === user)
    .map((node) => new Date(node.createdAt))
    .toSorted((a, b) => a - b);

  const reviews = details.reviews.nodes
    .filter((node) => node?.author?.login === user && node.submittedAt)
    .map((node) => new Date(node.submittedAt))
    .toSorted((a, b) => a - b);

  if (requests.length === 0) {
    /**
     * The reviewed-by search also returns PRs where you reviewed without a
     * direct request, for example via a team request. There is no personal
     * request timestamp, so these cannot go into the histogram.
     */
    return reviews.length > 0 ? { kind: 'unrequested', pr } : { kind: 'inaccessible', pr };
  }

  const firstRequest = requests[0];

  const firstReviewAfterRequest = reviews.find((review) => review >= firstRequest);

  if (!firstReviewAfterRequest) {
    return { kind: 'pending', pr, requestedAt: firstRequest };
  }

  return {
    kind: 'reviewed',
    pr,
    hours: durationHours(firstRequest, firstReviewAfterRequest),
  };
}

/**
 * Runs the time-to-review analysis over the PRs where the user was
 * requested as a reviewer or already reviewed.
 */
export async function analyzeReviewTimes({ requested, reviewed, user, targetHours, targetLabel }) {
  const prByKey = new Map();

  for (const item of [...requested, ...reviewed]) {
    const repo = item.repository.nameWithOwner;

    prByKey.set(`${repo}#${item.number}`, {
      repo,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
    });
  }

  const prs = [...prByKey.values()];

  if (prs.length === 0) {
    console.info('No reviewed or review-requested PRs found.');
    return;
  }

  if (requested.length >= 1000 || reviewed.length >= 1000) {
    console.warn('Warning, a search hit the 1000 result cap, so data may be incomplete. Narrow --since or --repo.');
  }

  console.info(`Found ${prs.length} PRs, fetching review timelines...`);

  const results = [];
  const batchSize = 25;

  for (let offset = 0; offset < prs.length; offset += batchSize) {
    const batch = prs.slice(offset, offset + batchSize);
    const detailsList = await fetchPrDetails(batch);

    for (const [i, element] of batch.entries()) {
      results.push(analyzePr(element, detailsList[i], user));
    }

    process.stdout.write(`\r  ${Math.min(offset + batchSize, prs.length)}/${prs.length}`);
  }

  process.stdout.write('\n');

  const reviewedResults = results.filter((result) => result.kind === 'reviewed');

  const pending = results.filter((result) => result.kind === 'pending' && result.pr.state === 'open');

  const now = new Date();

  for (const result of pending) {
    result.hours = durationHours(result.requestedAt, now);
  }

  const expired = results.filter((result) => result.kind === 'pending' && result.pr.state !== 'open');

  const unrequested = results.filter((result) => result.kind === 'unrequested');

  console.info(
    `\n${reviewedResults.length} reviewed after a direct request, ` +
      `${pending.length} open and awaiting your review, ` +
      `${expired.length} closed or merged without your review, ` +
      `${unrequested.length} reviewed without a direct request (excluded)`,
  );

  if (reviewedResults.length === 0) {
    console.info('Nothing to chart.');
    return;
  }

  const allHours = reviewedResults.map((result) => result.hours);

  const pendingHours = pending.map((result) => result.hours);

  printHistogram(`Time to review, all repos (n=${allHours.length})`, allHours);
  printStats(allHours, targetHours, targetLabel, pendingHours);

  const byRepo = new Map();

  for (const result of reviewedResults) {
    if (!byRepo.has(result.pr.repo)) {
      byRepo.set(result.pr.repo, []);
    }

    byRepo.get(result.pr.repo).push(result.hours);
  }

  if (byRepo.size > 1) {
    const sortedByRepo = [...byRepo.entries()].toSorted((a, b) => {
      return b[1].length - a[1].length;
    });

    for (const [repo, hoursList] of sortedByRepo) {
      printHistogram(`Time to review, ${repo} (n=${hoursList.length})`, hoursList);

      const repoPendingHours = pending.filter((result) => result.pr.repo === repo).map((result) => result.hours);

      printStats(hoursList, targetHours, targetLabel, repoPendingHours);
    }
  }

  if (targetHours !== undefined) {
    const misses = reviewedResults.filter((result) => result.hours > targetHours).toSorted((a, b) => b.hours - a.hours);

    if (misses.length > 0) {
      console.info(`\nReviews that missed the <= ${targetLabel} target`);

      const rows = misses.map((result) => {
        return {
          result,
          duration: `${formatHoursOnly(result.hours).padStart(8)}${weeksSuffix(result.hours)}`,
        };
      });

      const width = Math.max(...rows.map((row) => row.duration.length));

      for (const { result, duration } of rows) {
        const ref = link(`${result.pr.repo}#${result.pr.number}`, result.pr.url);

        console.info(`  ${duration.padEnd(width)}  ${ref}  ${result.pr.title}`);
      }
    }
  }

  if (pending.length > 0) {
    console.info('\nOpen and awaiting your review');

    const rows = pending
      .toSorted((a, b) => a.requestedAt - b.requestedAt)
      .map((result) => {
        return {
          result,
          duration: `${formatHoursOnly(result.hours).padStart(8)}${weeksSuffix(result.hours)}`,
        };
      });

    const width = Math.max(...rows.map((row) => row.duration.length));

    for (const { result, duration } of rows) {
      const ref = link(`${result.pr.repo}#${result.pr.number}`, result.pr.url);

      console.info(`  ${duration.padEnd(width)}  ${ref}  ${result.pr.title}`);
    }
  }
}

/**
 * Runs the size analysis over the PRs the user authored. Sizes cover files
 * changed, lines added, lines removed, and their total. The charts argument
 * is a Set that picks which of the size charts get printed.
 */
export async function analyzeAuthoredSizes({ authored, sizeTarget, charts }) {
  const prs = authored.map((item) => {
    return {
      repo: item.repository.nameWithOwner,
      number: item.number,
      title: item.title,
      url: item.url,
      createdAt: new Date(item.createdAt),
    };
  });

  if (prs.length === 0) {
    console.info('\nNo authored PRs found.');
    return;
  }

  if (authored.length >= 1000) {
    console.warn('Warning, the authored search hit the 1000 result cap, so data may be incomplete.');
  }

  console.info(`\nFound ${prs.length} authored PRs, fetching sizes...`);

  const sizes = [];
  const batchSize = 25;

  for (let offset = 0; offset < prs.length; offset += batchSize) {
    const batch = prs.slice(offset, offset + batchSize);
    const detailsList = await fetchPrSizes(batch);

    for (const [i, pr] of batch.entries()) {
      const details = detailsList[i];

      if (details) {
        sizes.push({
          pr,
          files: details.changedFiles,
          additions: details.additions,
          deletions: details.deletions,
          total: details.additions + details.deletions,
        });
      }
    }

    process.stdout.write(`\r  ${Math.min(offset + batchSize, prs.length)}/${prs.length}`);
  }

  process.stdout.write('\n');

  if (sizes.length === 0) {
    console.info('No accessible authored PRs to analyze.');
    return;
  }

  if (sizes.length < prs.length) {
    console.info(`${prs.length - sizes.length} authored PRs were inaccessible and are excluded.`);
  }

  const metrics = [
    { label: 'files changed', values: sizes.map((size) => size.files) },
    { label: 'lines added', values: sizes.map((size) => size.additions) },
    { label: 'lines removed', values: sizes.map((size) => size.deletions) },
    { label: 'lines total', values: sizes.map((size) => size.total) },
  ];

  printSizeStats(`Authored PR sizes (n=${sizes.length})`, metrics);

  const meetsTarget = (size) =>
    (sizeTarget.lines === undefined || size.total <= sizeTarget.lines) &&
    (sizeTarget.files === undefined || size.files <= sizeTarget.files);

  if (sizeTarget !== undefined) {
    const targetLabel = [
      ...(sizeTarget.lines === undefined ? [] : [`<= ${sizeTarget.lines} lines`]),
      ...(sizeTarget.files === undefined ? [] : [`<= ${sizeTarget.files} files`]),
    ].join(', ');

    const met = sizes.filter((size) => meetsTarget(size)).length;
    const pct = (met / sizes.length) * 100;
    const filled = Math.round((pct / 100) * 30);
    const gauge = '█'.repeat(filled) + '░'.repeat(30 - filled);

    console.info(`  target ${targetLabel}  ${gauge} ${pct.toFixed(0)}% met (${met}/${sizes.length})`);
  }

  if (charts.has('histogram')) {
    printHistogram(
      `Authored PR sizes, lines total (n=${sizes.length})`,
      sizes.map((size) => size.total),
      LINE_BUCKETS,
    );

    printHistogram(
      `Authored PR sizes, files changed (n=${sizes.length})`,
      sizes.map((size) => size.files),
      FILE_BUCKETS,
    );
  }

  if (charts.has('strip')) {
    printQuantileStrips('Authored PR size spread, log scale (▒ p25-p75, █ p50)', metrics);
  }

  if (charts.has('spark')) {
    const chronological = [...sizes].toSorted((a, b) => a.pr.createdAt - b.pr.createdAt);

    printSizeTimeline(chronological.map((size) => size.total));
  }

  if (sizeTarget === undefined) {
    return;
  }

  const misses = sizes.filter((size) => !meetsTarget(size)).toSorted((a, b) => b.total - a.total);

  if (misses.length === 0) {
    return;
  }

  console.info('\nAuthored PRs over the size target');

  const rows = misses.map((size) => {
    return {
      size,
      desc: `+${size.additions}/-${size.deletions}, ${size.files} files`,
    };
  });

  const width = Math.max(...rows.map((row) => row.desc.length));

  for (const { size, desc } of rows) {
    const ref = link(`${size.pr.repo}#${size.pr.number}`, size.pr.url);

    console.info(`  ${desc.padEnd(width)}  ${ref}  ${size.pr.title}`);
  }
}
