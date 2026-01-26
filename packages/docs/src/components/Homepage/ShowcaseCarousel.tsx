import React, {useRef, useState, useEffect} from 'react';
import styles from './ShowcaseCarousel.module.css';

interface ShowcaseItem {
  id: string;
  title: string;
  description: string;
  videoId?: string;
  imageUrl?: string;
  link?: string;
}

const ShowcaseItems: ShowcaseItem[] = [
  {
    id: '1',
    title: 'Animated Diagrams',
    description: 'Create beautiful animated diagrams and flowcharts',
    videoId: 'R6vQ9VmMz2w',
  },
  {
    id: '2',
    title: 'Code Animations',
    description: 'Visualize code execution step by step',
    videoId: 'WTUafAwrunE',
  },
  {
    id: '3',
    title: 'Math Visualizations',
    description: 'Bring mathematical concepts to life',
    videoId: 'Ey9bHQs7khs',
  },
  {
    id: '4',
    title: 'Data Stories',
    description: 'Tell compelling stories with animated data',
    videoId: 'P1Z1ZmZqWXA',
  },
];

export default function ShowcaseCarousel(): JSX.Element {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToIndex = (index: number) => {
    if (carouselRef.current) {
      const itemWidth = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: index * itemWidth,
        behavior: 'smooth',
      });
    }
  };

  const handleScroll = () => {
    if (carouselRef.current) {
      const scrollPosition = carouselRef.current.scrollLeft;
      const itemWidth = carouselRef.current.offsetWidth;
      const newIndex = Math.round(scrollPosition / itemWidth);
      setActiveIndex(newIndex);
    }
  };

  useEffect(() => {
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener('scroll', handleScroll);
      return () => carousel.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const goToPrevious = () => {
    const newIndex = activeIndex > 0 ? activeIndex - 1 : ShowcaseItems.length - 1;
    scrollToIndex(newIndex);
  };

  const goToNext = () => {
    const newIndex = activeIndex < ShowcaseItems.length - 1 ? activeIndex + 1 : 0;
    scrollToIndex(newIndex);
  };

  return (
    <div className={styles.showcaseContainer}>
      <h2 className={styles.showcaseTitle}>See What's Possible</h2>
      <p className={styles.showcaseSubtitle}>
        Explore animations created with Motion Canvas
      </p>

      <div className={styles.carouselWrapper}>
        <button
          className={`${styles.navButton} ${styles.prevButton}`}
          onClick={goToPrevious}
          aria-label="Previous"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18L9 12L15 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className={styles.carousel} ref={carouselRef}>
          {ShowcaseItems.map((item) => (
            <div key={item.id} className={styles.carouselItem}>
              <div className={styles.videoWrapper}>
                {item.videoId ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${item.videoId}?rel=0`}
                    title={item.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} />
                ) : null}
              </div>
              <div className={styles.itemContent}>
                <h3 className={styles.itemTitle}>{item.title}</h3>
                <p className={styles.itemDescription}>{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          className={`${styles.navButton} ${styles.nextButton}`}
          onClick={goToNext}
          aria-label="Next"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 18L15 12L9 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className={styles.indicators}>
        {ShowcaseItems.map((_, index) => (
          <button
            key={index}
            className={`${styles.indicator} ${index === activeIndex ? styles.active : ''}`}
            onClick={() => scrollToIndex(index)}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
