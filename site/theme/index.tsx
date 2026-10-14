// The site's Rspress theme (rspress.config.ts `themeDir`): the stock theme,
// with a home whose hero plays a run where Rspress shows an image and gives
// the install command above its actions, the golden
// path drawn under the hero and following that run, and the page's own Markdown (the README's intro
// and quickstart) under the features, which Rspress's home leaves out.
import {
  DocContent,
  HomeHero as BasicHomeHero,
  HomeLayout as BasicHomeLayout,
  type HomeHeroProps,
} from "@rspress/core/theme-original";
import type { ReactElement } from "react";
import { GoldenPath } from "./GoldenPath.js";
import { InstallCommand } from "./InstallCommand.js";
import { LiveRun } from "./LiveRun.js";
import { LiveRunPlayback } from "./playback.js";
import "./home.css";

export function HomeHero(props: HomeHeroProps): ReactElement {
  return <BasicHomeHero {...props} beforeHeroActions={<InstallCommand />} image={<LiveRun />} />;
}

export function HomeLayout(): ReactElement {
  return (
    <LiveRunPlayback>
      <BasicHomeLayout
        afterHero={<GoldenPath />}
        afterFeatures={
          <div className="phax-home-doc rp-doc rspress-doc">
            <DocContent components={undefined} />
          </div>
        }
      />
    </LiveRunPlayback>
  );
}

export * from "@rspress/core/theme-original";
