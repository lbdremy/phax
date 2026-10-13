// The site's Rspress theme (rspress.config.ts `themeDir`): the stock theme,
// with a home that draws the golden path under the hero and renders the
// page's own Markdown (the README's intro and quickstart) under the features,
// which Rspress's home leaves out.
import { DocContent, HomeLayout as BasicHomeLayout } from "@rspress/core/theme-original";
import { GoldenPath } from "./GoldenPath.js";
import "./home.css";

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
