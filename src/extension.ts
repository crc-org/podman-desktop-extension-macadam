/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import * as path from 'node:path';

import * as extensionApi from '@podman-desktop/api';

import { LoggerDelegator } from './logger';
import { Macadam } from './macadam';
import { ProviderConnectionShellAccessImpl } from './macadam-machine-stream';
import { getErrorMessage } from './utils';

const MACADAM_CLI_NAME = 'macadam';
const MACADAM_DISPLAY_NAME = 'Macadam';
const MACADAM_MARKDOWN = `Podman Desktop can help you run RHEL and other linux-based VM by using Macadam.\n\nMore information: Link to macadam here`;
const stopLoop = false;

type StatusHandler = (name: string, event: extensionApi.ProviderConnectionStatus) => void;
const macadamMachinesInfo = new Map<string, MachineInfo>();
const currentConnections = new Map<string, extensionApi.Disposable>();

const listeners = new Set<StatusHandler>();

export interface BinaryInfo {
  path: string;
  version: string;
  installationSource: 'extension' | 'external';
}

export type MachineInfo = {
  image: string;
  cpus: number;
  memory: number;
  diskSize: number;
  port: number;
  remoteUsername: string;
  identityPath: string;
};

type MachineJSON = {
  Image: string;
  CPUs: number;
  Memory: string;
  DiskSize: string;
  Running: boolean;
  Starting: boolean;
  Port: number;
  RemoteUsername: string;
  IdentityPath: string;
};

type MachineJSONListOutput = {
  list: MachineJSON[];
  error: string;
};

export const macadamMachinesStatuses = new Map<string, extensionApi.ProviderConnectionStatus>();

export async function activate(extensionContext: extensionApi.ExtensionContext): Promise<void> {
  const macadam = new Macadam(extensionContext.storagePath);

  let binary: BinaryInfo | undefined = undefined;
  // retrieve macadam
  try {
    binary = await macadam.getBinaryInfo();
  } catch (err: unknown) {
    console.error(err);
  }

  const provider = await createProvider(extensionContext, macadam);

  monitorMachines(macadam, provider, extensionContext).catch((error: unknown) => {
    console.error('Error while monitoring machines', error);
  });

  // create cli tool for the cliTool page in desktop
  const macadamCli = extensionApi.cli.createCliTool({
    name: MACADAM_CLI_NAME,
    images: {
      icon: './icon.png',
    },
    version: binary?.version,
    path: binary?.path,
    displayName: MACADAM_DISPLAY_NAME,
    markdownDescription: MACADAM_MARKDOWN,
    installationSource: binary?.installationSource,
  });

  extensionContext.subscriptions.push(macadamCli);
}

async function timeout(time: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, time);
  });
}

async function getJSONMachineList(macadam: Macadam): Promise<MachineJSONListOutput> {
  const list: MachineJSON[] = [];
  let error = '';

  try {
    const macadamCli = await macadam.getExecutable();
    const { stdout, stderr } = await extensionApi.process.exec(macadamCli, ['list']);
    list.push(...(JSON.parse(stdout) as MachineJSON[]));
    error = stderr;
  } catch (err) {
    error = getErrorMessage(err);
  }

  return { list, error };
}

async function startMachine(
  macadam: Macadam,
  provider: extensionApi.Provider,
  context?: extensionApi.LifecycleContext,
  logger?: extensionApi.Logger,
): Promise<void> {
  const telemetryRecords: Record<string, unknown> = {};
  telemetryRecords.provider = 'macadam';
  const startTime = performance.now();

  try {
    const macadamCli = await macadam.getExecutable();
    await extensionApi.process.exec(macadamCli, ['start'], {
      logger: new LoggerDelegator(context, logger),
    });
    provider.updateStatus('started');
  } catch (err) {
    telemetryRecords.error = err;
    console.error(err);
    throw err;
  } finally {
    // send telemetry event
    const endTime = performance.now();
    telemetryRecords.duration = endTime - startTime;
    //in the POC we do not send any telemetry
    // sendTelemetryRecords('macadam.machine.start', telemetryRecords, true);
  }
}

async function stopMachine(
  macadam: Macadam,
  provider: extensionApi.Provider,
  context?: extensionApi.LifecycleContext,
  logger?: extensionApi.Logger,
): Promise<void> {
  const startTime = performance.now();
  const telemetryRecords: Record<string, unknown> = {};
  telemetryRecords.provider = 'macadam';
  try {
    const macadamCli = await macadam.getExecutable();
    await extensionApi.process.exec(macadamCli, ['stop'], {
      logger: new LoggerDelegator(context, logger),
    });
    provider.updateStatus('stopped');
  } catch (err: unknown) {
    telemetryRecords.error = err;
    throw err;
  } finally {
    // send telemetry event
    const endTime = performance.now();
    telemetryRecords.duration = endTime - startTime;
    //in the POC we do not send any telemetry
    //sendTelemetryRecords('macadam.machine.stop', telemetryRecords, false);
  }
}

async function registerProviderFor(
  macadam: Macadam,
  provider: extensionApi.Provider,
  machineInfo: MachineInfo,
  socketPath: string,
  context: extensionApi.ExtensionContext,
): Promise<void> {
  const lifecycle: extensionApi.ProviderConnectionLifecycle = {
    start: async (context, logger): Promise<void> => {
      await startMachine(macadam, provider, context, logger);
    },
    stop: async (context, logger): Promise<void> => {
      await stopMachine(macadam, provider, context, logger);
    },
    delete: async (logger): Promise<void> => {
      const macadamCli = await macadam.getExecutable();
      await extensionApi.process.exec(macadamCli, ['rm'], {
        logger,
      });
    },
  };

  const providerConnectionShellAccess = new ProviderConnectionShellAccessImpl(machineInfo);
  context.subscriptions.push(providerConnectionShellAccess);

  const containerProviderConnection: extensionApi.ContainerProviderConnection = {
    name: 'macadam',
    displayName: 'Macadam',
    type: 'podman',
    status: () => macadamMachinesStatuses.get(machineInfo.image) ?? 'unknown',
    shellAccess: providerConnectionShellAccess,
    lifecycle,
    endpoint: {
      socketPath,
    },
  };

  // Since Podman 4.5, machines are using the same path for all sockets of machines
  // so a machine is not distinguishable from another one.
  // monitorPodmanSocket(socketPath, machineInfo.name);

  const disposable = provider.registerContainerProviderConnection(containerProviderConnection);
  provider.updateStatus('ready');

  // get configuration for this connection
  const containerConfiguration = extensionApi.configuration.getConfiguration('macadam', containerProviderConnection);

  // Set values for the machine
  await containerConfiguration.update('machine.cpus', machineInfo.cpus);
  await containerConfiguration.update('machine.memory', machineInfo.memory);
  await containerConfiguration.update('machine.diskSize', machineInfo.diskSize);

  currentConnections.set(machineInfo.image, disposable);
  /*storedExtensionContext?.subscriptions.push(disposable); */
}

async function updateMachines(
  macadam: Macadam,
  provider: extensionApi.Provider,
  context: extensionApi.ExtensionContext,
): Promise<void> {
  // init machines available
  const machineListOutput = await getJSONMachineList(macadam);

  if (machineListOutput.error) {
    // TODO handle the error
  }

  // parse output
  const machines = machineListOutput.list;

  // update status of existing machines - in the POC only one can exist, just to keep code that can be reused in future
  for (const machine of machines) {
    const running = machine?.Running === true;
    let status: extensionApi.ProviderConnectionStatus = running ? 'started' : 'stopped';

    // update the status to starting if the machine is running but still starting
    const starting = machine?.Starting === true;
    if (starting) {
      status = 'starting';
    }

    const previousStatus = macadamMachinesStatuses.get(machine.Image);
    if (previousStatus !== status) {
      // notify status change
      listeners.forEach(listener => listener(machine.Image, status));
      macadamMachinesStatuses.set(machine.Image, status);
    }

    // TODO update cpu/memory/disk usage

    macadamMachinesInfo.set(machine.Image, {
      image: machine.Image,
      memory: Number(machine.Memory),
      cpus: Number(machine.CPUs),
      diskSize: Number(machine.DiskSize),
      port: machine.Port,
      remoteUsername: machine.RemoteUsername,
      identityPath: machine.IdentityPath,
    });

    if (!macadamMachinesStatuses.has(machine.Image)) {
      macadamMachinesStatuses.set(machine.Image, status);
    }
  }

  // remove machine no longer there
  const machinesToRemove = Array.from(macadamMachinesStatuses.keys()).filter(
    machine => !machines.find(m => m.Image === machine),
  );
  machinesToRemove.forEach(machine => {
    macadamMachinesStatuses.delete(machine);
  });

  // create connections for new machines
  const connectionsToCreate = Array.from(macadamMachinesStatuses.keys()).filter(
    machineStatusKey => !currentConnections.has(machineStatusKey),
  );
  await Promise.all(
    connectionsToCreate.map(async machineName => {
      const podmanMachineInfo = macadamMachinesInfo.get(machineName);
      if (podmanMachineInfo) {
        await registerProviderFor(
          macadam,
          provider,
          podmanMachineInfo,
          '/var/folders/n4/n5hyrstd2739lcy9903jn8f40000gn/T/podman/macadam.sock',
          context,
        );
      }
    }),
  );

  // delete connections for machines no longer there
  machinesToRemove.forEach(machine => {
    const disposable = currentConnections.get(machine);
    if (disposable) {
      disposable.dispose();
      currentConnections.delete(machine);
    }
  });

  // If the machine length is zero and we are on macOS or Windows,
  // we will update the provider as being 'installed', or ready / starting / configured if there is a machine
  // if we are on Linux, ignore this as podman machine is OPTIONAL and the provider status in Linux is based upon
  // the native podman installation / not machine.
  if (!extensionApi.env.isLinux) {
    if (machines.length === 0) {
      if (provider.status !== 'configuring') {
        provider.updateStatus('installed');
      }
    } else {
      /*
       * The machine can have 3 states, based on `Starting` and `Running` fields:
       * - !Running && !Starting -> configured
       * -  Running &&  Starting -> starting
       * -  Running && !Starting -> ready
       */
      const atLeastOneMachineRunning = machines.some(machine => machine.Running && !machine.Starting);
      const atLeastOneMachineStarting = machines.some(machine => machine.Starting);
      // if a machine is running it's started else it is ready
      if (atLeastOneMachineRunning) {
        provider.updateStatus('ready');
      } else if (atLeastOneMachineStarting) {
        // update to starting
        provider.updateStatus('starting');
      } else {
        // needs to start a machine
        provider.updateStatus('configured');
      }

      // Finally, we check to see if the machine that is running is set by default or not on the CLI
      // this will create a dialog that will ask the user if they wish to set the running machine as default.
      // this should only run if we at least one machine
      //await checkDefaultMachine(machines);
    }
  }
}

async function monitorMachines(
  macadam: Macadam,
  provider: extensionApi.Provider,
  context: extensionApi.ExtensionContext,
): Promise<void> {
  // call us again
  if (!stopLoop) {
    try {
      await updateMachines(macadam, provider, context);
    } catch (error) {
      // ignore the update of machines
    }
    await timeout(5000);
    monitorMachines(macadam, provider, context).catch((error: unknown) => {
      console.error('Error monitoring podman machines', error);
    });
  }
}

async function createProvider(
  extensionContext: extensionApi.ExtensionContext,
  macadam: Macadam,
): Promise<extensionApi.Provider> {
  const providerOptions: extensionApi.ProviderOptions = {
    name: 'Macadam',
    id: 'macadam',
    status: 'unknown',
    images: {
      icon: './icon.png',
      logo: {
        dark: './icon.png',
        light: './icon.png',
      },
    },
    emptyConnectionMarkdownDescription: MACADAM_MARKDOWN,
  };

  const provider = extensionApi.provider.createProvider(providerOptions);

  extensionContext.subscriptions.push(provider);

  // enable factory
  provider.setContainerProviderConnectionFactory({
    create: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: { [key: string]: any },
      logger?: extensionApi.Logger,
      token?: extensionApi.CancellationToken,
    ) => {
      return createVM(macadam, params, logger, token);
    },
    creationDisplayName: 'Virtual machine',
  });
  

  return provider;
}

async function createVM(
  macadam: Macadam,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: { [key: string]: any },
  logger?: extensionApi.Logger,
  token?: extensionApi.CancellationToken,
): Promise<void> {
  const parameters = [];
  parameters.push('init');

  const telemetryRecords: Record<string, unknown> = {};
  if (extensionApi.env.isMac) {
    telemetryRecords.OS = 'mac';
  }

  /* To be uncommented when init command will support these flags
  // cpu
  if (params['macadam.factory.machine.cpus']) {
    const cpusValue = params['macadam.factory.machine.cpus'];
    parameters.push('--cpus');
    parameters.push(cpusValue);
    telemetryRecords.cpus = cpusValue;
  }

  // memory
  if (params['macadam.factory.machine.memory']) {
    parameters.push('--memory');
    const memoryAsMiB = +params['macadam.factory.machine.memory'] / (1024 * 1024);
    // Hyper-V requires VMs to have memory in 2 MB increments. So we round it
    const roundedMemoryMiB = Math.floor((memoryAsMiB + 1) / 2) * 2;
    parameters.push(roundedMemoryMiB.toString());
    telemetryRecords.memory = params['macadam.factory.machine.memory'];
  }

  // disk size
  if (params['macadam.factory.machine.diskSize']) {
    parameters.push('--disk-size');
    const diskAsGiB = +params['macadam.factory.machine.diskSize'] / (1024 * 1024 * 1024);
    parameters.push(Math.floor(diskAsGiB).toString());
    telemetryRecords.diskSize = params['macadam.factory.machine.diskSize'];
  }
  */

  // image-path
  const imagePath = params['macadam.factory.machine.image-path'];
  if (imagePath) {
    parameters.push(imagePath);
    telemetryRecords.imagePath = 'custom';
  }

  // push args for demo
  parameters.push('--ssh-identity-path');
  parameters.push(path.join(path.dirname(imagePath), 'id_ed25519'));
  parameters.push('--username');
  parameters.push('core');

  /*   else if (params['macadam.factory.machine.image-uri']) {
    const imageUri = params['macadam.factory.machine.image-uri'].trim();
    parameters.push('--image-path');
    if (imageUri.startsWith('https://') || imageUri.startsWith('http://')) {
      parameters.push(imageUri);
      telemetryRecords.imagePath = 'custom-url';
    } else {
      parameters.push(`docker://${imageUri}`);
      telemetryRecords.imagePath = 'custom-registry';
    }
  } */

  /* if (!telemetryRecords.imagePath) {
    telemetryRecords.imagePath = 'default';
  } */

  // name at the end
  /*  if (params['macadam.factory.machine.name']) {
    parameters.push(params['macadam.factory.machine.name']);
    telemetryRecords.customName = params['macadam.factory.machine.name'];
    telemetryRecords.defaultName = false;
  } else {
    telemetryRecords.defaultName = true;
  } */

  const startTime = performance.now();
  try {
    const macadamCli = await macadam.getExecutable();
    await extensionApi.process.exec(macadamCli, parameters, {
      logger,
      token,
    });
  } catch (error) {
    telemetryRecords.error = error;
    const runError = error as extensionApi.RunError;

    let errorMessage = runError.name ? `${runError.name}\n` : '';
    errorMessage += runError.message ? `${runError.message}\n` : '';
    errorMessage += runError.stderr ? `${runError.stderr}\n` : '';
    throw errorMessage || error;
  } finally {
    const endTime = performance.now();
    telemetryRecords.duration = endTime - startTime;
    //in the POC we do not send any telemetry
    //sendTelemetryRecords('macadam.machine.init', telemetryRecords, false);
  }
}
