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
  //const telemetryLogger = extensionApi.env.createTelemetryLogger();
  const macadam = new Macadam(extensionContext.storagePath);

  let binary: BinaryInfo | undefined = undefined;
  // retrieve macadam
  try {
    binary = await macadam.getBinaryInfo();
  } catch (err: unknown) {
    console.error(err);
  }

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
