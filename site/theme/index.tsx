// The site's Rspress theme (rspress.config.ts `themeDir`): the stock theme,
// with a home whose hero plays a run where Rspress shows an image, the golden
// path drawn under the hero, and the page's own Markdown (the README's intro
// and quickstart) under the features, which Rspress's home leaves out.
import {
  DocContent,
  HomeHero as BasicHomeHero,
  HomeLayout as BasicHomeLayout,
  type HomeHeroProps,
} from "@rspress/core/theme-original";
import { GoldenPath } from "./GoldenPath.js";
import { LiveRun } from "./LiveRun.js";
import "./home.css";

export function HomeHero(props: HomeHeroProps) {
  return <BasicHomeHero {...props} image={<LiveRun />} />;
}

export function HomeLayout() {
  return (
    <BasicHomeLayout
      afterHero={<GoldenPath />}
      afterFeatures={
        <div className="phax-home-doc rp-doc rspress-doc">
          <DocContent components={undefined} />
        </div>
      }
    />
  );
}

export * from "@rspress/core/theme-original";
