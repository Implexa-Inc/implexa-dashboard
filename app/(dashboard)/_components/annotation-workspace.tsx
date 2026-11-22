'use client';

import {forwardRef,type ComponentPropsWithoutRef} from 'react';

/** One responsive stage/notes layout for recording and result annotation. */
const AnnotationWorkspace=forwardRef<HTMLDivElement,ComponentPropsWithoutRef<'div'>>(function AnnotationWorkspace({className='',...props},ref){
 return <div {...props} ref={ref} className={`annotation-workspace ${className}`}/>;
});
export default AnnotationWorkspace;
