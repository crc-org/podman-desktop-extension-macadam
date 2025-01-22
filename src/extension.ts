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

import * as extensionApi from '@podman-desktop/api';

import { Macadam } from './macadam';

const MACADAM_CLI_NAME = 'macadam';
const MACADAM_DISPLAY_NAME = 'Macadam';
const MACADAM_MARKDOWN = `Podman Desktop can help you run RHEL and other linux-based VM by using Macadam.\n\nMore information: Link to macadam here`;

export interface BinaryInfo {
  path: string;
  version: string;
  installationSource: 'extension' | 'external';
}

export async function activate(extensionContext: extensionApi.ExtensionContext): Promise<void> {
  const macadam = new Macadam(extensionContext.storagePath);

  let binary: BinaryInfo | undefined = undefined;
  // retrieve macadam
  try {
    binary = await macadam.getBinaryInfo();
  } catch (err: unknown) {
    console.error(err);
  }

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

  await createProvider(extensionContext, macadam);
}

async function createProvider(extensionContext: extensionApi.ExtensionContext, macadam: Macadam): Promise<void> {
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

  // enable factory - only on mac atm as i'm using it for testing
  if (extensionApi.env.isMac) {
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
  }
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

  // image-path
  if (params['macadam.factory.machine.image-path']) {
    parameters.push('--image-path');
    parameters.push(params['macadam.factory.machine.image-path']);
    telemetryRecords.imagePath = 'custom';
  } else if (params['macadam.factory.machine.image-uri']) {
    const imageUri = params['macadam.factory.machine.image-uri'].trim();
    parameters.push('--image-path');
    if (imageUri.startsWith('https://') || imageUri.startsWith('http://')) {
      parameters.push(imageUri);
      telemetryRecords.imagePath = 'custom-url';
    } else {
      parameters.push(`docker://${imageUri}`);
      telemetryRecords.imagePath = 'custom-registry';
    }
  }

  if (!telemetryRecords.imagePath) {
    telemetryRecords.imagePath = 'default';
  }
  */

  // name at the end
  if (params['macadam.factory.machine.name']) {
    parameters.push(params['macadam.factory.machine.name']);
    telemetryRecords.customName = params['macadam.factory.machine.name'];
    telemetryRecords.defaultName = false;
  } else {
    telemetryRecords.defaultName = true;
  }

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
