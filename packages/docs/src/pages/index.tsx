import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import HomepageFeatures from '@site/src/components/Homepage/Features';
import HomepageHeader from '@site/src/components/Homepage/Header';
import ShowcaseCarousel from '@site/src/components/Homepage/ShowcaseCarousel';
import Layout from '@theme/Layout';
import React from 'react';
import styles from './index.module.css';

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <Head>
        <title>
          {siteConfig.title} - {siteConfig.tagline}
        </title>
        <meta property="og:title" content={siteConfig.title} />
      </Head>
      <div className={styles.homeContainer}>
        <HomepageHeader />
        <ShowcaseCarousel />
      </div>
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
