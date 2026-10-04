import { test,expect } from './fixture.js';
import { readFileSync } from 'node:fs';
import type { BenchJob } from '../../src/bench-runner.js';

test('horizontal and vertical splits drag, persist, reset independently, and work in Stats',async({page,room},info)=>{
  await page.goto(room.url);
  const height=page.getByRole('separator',{name:'Resize the CLI and lower panes',exact:true});
  const width=page.getByRole('separator',{name:'Resize the agent panes',exact:true});
  await expect(height).toHaveAttribute('aria-valuenow','50');
  const box=(await height.boundingBox())!;
  await page.mouse.move(box.x+100,box.y);await page.mouse.down();await page.mouse.move(box.x+100,270,{steps:8});await page.mouse.up();
  await expect(height).toHaveAttribute('aria-valuenow','30');
  await width.focus();await page.keyboard.press('ArrowRight');await expect(width).toHaveAttribute('aria-valuenow','55');
  await page.reload();await expect(height).toHaveAttribute('aria-valuenow','30');await expect(width).toHaveAttribute('aria-valuenow','55');
  await height.focus();await page.keyboard.press('Shift+ArrowDown');await expect(height).toHaveAttribute('aria-valuenow','40');
  await page.keyboard.press('Enter');await expect(height).toHaveAttribute('aria-valuenow','50');await expect(width).toHaveAttribute('aria-valuenow','55');
  await page.getByRole('button',{name:'Stats',exact:true}).click();await expect(page.getByRole('heading',{name:'By agent'})).toBeVisible();
  await height.focus();await page.keyboard.press('ArrowUp');await expect(height).toHaveAttribute('aria-valuenow','45');
  await page.screenshot({path:info.outputPath('resized-stats.png')});
});

test('a saved prompt and renamed attachment survive reload and load into the composer',async({page,room},info)=>{
  await page.goto(room.url);await page.getByRole('button',{name:'Prompt library',exact:true}).click();
  const library=page.getByRole('dialog',{name:'Prompt library'});
  await library.getByRole('button',{name:'New prompt',exact:true}).click();
  await library.getByLabel('Prompt name',{exact:true}).fill('Browser saved prompt');
  await library.getByLabel('Saved prompt text',{exact:true}).fill('Use the attached reference to compare two approaches.');
  await library.locator('input[type=file][multiple]').setInputFiles({name:'reference.txt',mimeType:'text/plain',buffer:Buffer.from('Browser reference contents')});
  await library.getByLabel('Filename for reference.txt',{exact:true}).fill('renamed.md');
  await library.getByRole('button',{name:'Save prompt',exact:true}).click();
  await expect(library.getByRole('status')).toHaveText('Saved with its files.');
  await library.getByRole('button',{name:'Preview renamed.md',exact:true}).click();
  await expect(library.locator('.library-preview')).toContainText('Browser reference contents');
  await page.reload();await page.getByRole('button',{name:'Prompt library',exact:true}).click();
  await library.getByRole('button',{name:/Browser saved prompt/}).click();
  await expect(library.getByLabel('Filename for renamed.md',{exact:true})).toHaveValue('renamed.md');
  await page.screenshot({path:info.outputPath('saved-prompt.png')});
  await library.getByRole('button',{name:'Load into composer',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message both agents',exact:true})).toHaveValue('Use the attached reference to compare two approaches.');
  await expect(page.getByRole('button',{name:'Remove renamed.md',exact:true})).toBeVisible();
});

test('Build previews remain interactive after dragging the divider across both frames',async({page,room},info)=>{
  await page.goto(room.url);await page.getByRole('radio',{name:'Build',exact:true}).click();
  await page.getByRole('button',{name:/Browser fixture build/}).click();
  await page.getByRole('button',{name:'Results',exact:true}).click();
  const first=page.frameLocator('iframe').first();await expect(first.getByRole('heading',{name:'Working preview'})).toBeVisible();
  const divider=page.getByRole('separator',{name:'Resize the CLI and lower panes',exact:true});
  const box=(await divider.boundingBox())!;await page.mouse.move(box.x+100,box.y);await page.mouse.down();await page.mouse.move(box.x+200,650,{steps:10});await page.mouse.up();
  await expect.poll(async()=>Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(70);
  await first.getByRole('button',{name:'Try preview'}).click();await expect(first.getByRole('button',{name:'Preview clicked'})).toBeVisible();
  await page.getByRole('tab',{name:'Changes',exact:true}).click();await expect(page.getByRole('region',{name:'Both apps'})).toHaveCount(0);
  await page.getByRole('tab',{name:'Apps',exact:true}).click();await expect(first.getByRole('heading',{name:'Working preview'})).toBeVisible();
  await page.screenshot({path:info.outputPath('build-preview.png')});
});

test('Debate remembers its opener and exposes speaking, waiting and queued messages',async({page,room})=>{
  await page.goto(room.url);await page.getByRole('button',{name:'Options for the next prompt'}).click();
  const opening=page.getByRole('radiogroup',{name:'First to speak'});
  await expect(opening.getByRole('radio',{name:'Agent 1 (Codex)',exact:true})).toBeChecked();
  await opening.getByRole('radio',{name:'Agent 2 (Claude Code)',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Options for the next prompt'}).click();
  await expect(opening.getByRole('radio',{name:'Agent 2 (Claude Code)',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Close options',exact:true}).click();
  await page.getByRole('textbox',{name:'Message both agents',exact:true}).fill('Debate the next release for 30 seconds');
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await expect(page.getByRole('status',{name:'Debate turn order'})).toContainText('Agent 2 (Claude Code)');
  await expect.poll(()=>room.service.pairView(room.pairId).activeRun?.mode).toBe('conversation');
  const run=room.service.store.run(room.service.store.pair(room.pairId).activeRunId!);expect(run.config.opening).toBe('cli2');
  await page.getByRole('textbox',{name:'Message both agents',exact:true}).fill('Consider maintenance costs');
  await page.getByRole('textbox',{name:'Message both agents',exact:true}).press('Enter');
  await expect(page.getByRole('status',{name:'Debate turn order'})).toContainText('queued for the next turn');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
});

test('Resources saves a lower limit without stopping work, then stops all with confirmation',async({page,room},info)=>{
  await page.goto(room.url);await page.getByRole('button',{name:'Resources',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Resources',exact:true});
  await expect(panel.locator('.resource-totals')).toContainText('4 active or starting agents');
  await panel.getByLabel('Maximum active agents',{exact:true}).fill('2');await panel.getByRole('button',{name:'Save limit'}).click();
  await expect(panel.getByRole('status')).toHaveText('Activation limit saved. Existing work continues.');
  expect(room.service.resources.active().length).toBe(4);
  await page.screenshot({path:info.outputPath('resources.png')});
  await panel.getByRole('button',{name:'Stop all AvA agents'}).click();await expect(panel.getByRole('alert')).toContainText('every AvA room');
  await panel.getByRole('button',{name:'Confirm stop all'}).click();
  await expect(panel.getByRole('status')).toContainText('All AvA agents stopped.');
  await expect(panel.getByText('No active agents.',{exact:true})).toBeVisible();
  expect(room.service.store.threads().length).toBe(2);
});

test('Benchmarks validate tasks, show the ceiling, and recover a lost start acknowledgement after reload',async({page,room},info)=>{
  // The 20-task starter suite makes the selection steps slow on CI's runners (32 s there against Playwright's 30 s).
  test.setTimeout(90_000);
  await room.service.call('resources.configure',{maxActiveAgents:6,requestId:'browser-benchmark-capacity'});
  await page.goto(room.url);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Benchmarks',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Benchmarks',exact:true});
  // Only the invoice task, of the whole starter suite.
  for(const box of await panel.getByRole('checkbox',{name:/^Select /}).all())if(await box.isChecked())await box.uncheck();
  await panel.getByLabel('Select Add invoice amounts',{exact:true}).check();
  await expect(panel.getByRole('button',{name:'Run selected',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'Validate selected',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('All selected tasks validated');
  await expect(panel).toContainText('4 model requests');
  let dropped=false;
  await page.route('**/api',async route=>{
    const body=route.request().postDataJSON();
    if(body.method==='bench.start'&&!dropped){dropped=true;await room.service.call(body.method,body.params);await route.abort('failed');}
    else await route.continue();
  });
  await panel.getByRole('button',{name:'Run selected',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Retry benchmark start',exact:true})).toBeEnabled();
  await page.reload();await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Benchmarks',exact:true}).click();
  await expect(panel.getByLabel('Select Build a tip calculator',{exact:true})).not.toBeChecked();
  await panel.getByRole('button',{name:'Retry benchmark start',exact:true}).click();
  await expect(panel.getByRole('region',{name:'Benchmark progress'})).toContainText('completed · 2/2 attempts');
  expect(room.service.benchmarks.jobs()).toHaveLength(1);
  expect(room.service.benchmarks.jobs()[0]!.requestsAdmitted).toBe(4);
  // A finished job downloads as a standalone report.
  const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('button',{name:'Report (HTML)'}).click()]);
  expect(download.suggestedFilename()).toMatch(/^ava-benchmark-starter-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.html$/);
  expect(readFileSync((await download.path())!,'utf8')).toContain('Add invoice amounts');
  await page.screenshot({path:info.outputPath('benchmark-run.png')});
});

test('benchmark results filter models, retain evidence across reload, and export the filtered attempts',async({page,room},info)=>{
  // As above: a full starter-suite panel takes most of 30 s on CI's runners.
  test.setTimeout(90_000);
  await room.service.call('resources.configure',{maxActiveAgents:6,requestId:'results-capacity'});
  await room.service.call('bench.validate',{taskIds:['invoice-total']});
  const job=await room.service.call('bench.start',{pairId:room.pairId,taskIds:['invoice-total'],repeats:3,requestId:'browser-results'}) as BenchJob;
  await expect.poll(()=>room.service.benchmarks.get(job.id).status,{timeout:15000}).toBe('completed');
  await page.goto(room.url);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Benchmarks',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Benchmarks',exact:true});
  await panel.getByRole('tab',{name:'Results',exact:true}).click();
  const results=panel.getByRole('region',{name:'Saved benchmark results'});
  await expect(results.getByRole('status')).toContainText('6 attempts');
  await expect(results.getByRole('table',{name:'Benchmark scoreboard'}).locator('tbody tr')).toHaveCount(2);
  await results.getByLabel('Benchmark result model',{exact:true}).selectOption({label:'Codex · sim-model'});
  await expect(results.getByRole('status')).toContainText('3 attempts');
  await expect(results.getByRole('table',{name:'Benchmark scoreboard'}).locator('tbody tr')).toHaveCount(1);
  await expect(results.getByRole('table',{name:'Saved benchmark attempts'}).locator('tbody tr')).toHaveCount(3);
  await results.getByRole('button',{name:/Inspect invoice-total attempt/}).first().click();
  const evidence=results.getByRole('region',{name:'Benchmark attempt evidence'});
  await expect(evidence).toContainText('Exact answer did not match');
  await evidence.getByText('Check definition',{exact:true}).click();await expect(evidence).toContainText('"equals": "42"');
  for(const format of ['JSON','CSV']){
    const waiting=page.waitForEvent('download');await results.getByRole('button',{name:`Export ${format}`,exact:true}).click();
    const file=await waiting,path=info.outputPath(`results.${format.toLowerCase()}`);await file.saveAs(path);const text=readFileSync(path,'utf8');
    if(format==='JSON'){const exported=JSON.parse(text);expect(exported.attempts).toHaveLength(3);expect(exported.attempts.every((a:{agent:{provider:string}})=>a.agent.provider==='codex')).toBe(true);}
    else{expect(text).toContain('task_id,task_version');expect(text).toContain('"codex"');expect(text).not.toContain('"claude"');}
  }
  await results.getByText('Results over time (UTC)',{exact:true}).click();await expect(results.getByRole('table',{name:'Benchmark daily results'})).toBeVisible();
  await page.screenshot({path:info.outputPath('benchmark-scoreboard.png')});
  await results.getByLabel('Benchmark results from date',{exact:true}).fill('2099-01-01');await expect(results.getByRole('status')).toContainText('0 attempts');
  await page.reload();await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Benchmarks',exact:true}).click();await panel.getByRole('tab',{name:'Results',exact:true}).click();
  await expect(results.getByRole('status')).toContainText('6 attempts');expect(room.service.benchmarks.jobs()).toHaveLength(1);
});
